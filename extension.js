/*
 * im-switcher — switch the GNOME input method framework (IBus ⇄ Fcitx5)
 * from the top panel, with a restart/logout prompt.
 *
 * 源码字符串一律用英文，翻译走 gettext（po/zh_CN.po）。
 *
 * 安装：scripts/install.sh
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    FCITX5,
    IBUS,
    PROFILES,
    applyProfile,
    fcitxInstalled,
    pathsFor,
    pendingProfile,
    profileFromEnvValue,
} from './lib/profiles.js';
import {endSession} from './lib/session.js';

/**
 * St.BoxLayout 的朝向属性在 GNOME 48 从 vertical(bool) 换成了 orientation(enum)，
 * 新旧不兼容：48+ 传 vertical 会抛 "No property vertical"，
 * ≤47 传 orientation 会抛 "No property orientation"。
 * metadata 声明支持 45–52，所以这里按运行时实际支持的来，先试新的再退回老的。
 *
 * （这个坑是本项目在 instabox 的 Ubuntu 24.04 / GNOME 46 盒子上跑
 *  scripts/ci-shell-test.sh 时发现的——本地只有 GNOME 51，永远发现不了。）
 */
function boxLayout(vertical, extraParams = {}) {
    const params = {...extraParams};
    try {
        params.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;
        return new St.BoxLayout(params);
    } catch (error) {
        delete params.orientation;
        params.vertical = vertical;
        return new St.BoxLayout(params);
    }
}

const IMSwitcherIndicator = GObject.registerClass(
class IMSwitcherIndicator extends PanelMenu.Button {
    _init(paths) {
        super._init(0.0, _('Input Method'), false);

        this._paths = paths;

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'input-keyboard-symbolic',
        });
        this._label = new St.Label({
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const box = boxLayout(false, {style_class: 'panel-status-menu-box'});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuild();
        });
        this._rebuild();
        this._syncLabel();
    }

    _syncLabel() {
        this._label.text = PROFILES[pendingProfile(this._paths)].label;
    }

    _rebuild() {
        this.menu.removeAll();
        const pending = pendingProfile(this._paths);
        const live = profileFromEnvValue(GLib.getenv('GTK_IM_MODULE'));
        const waiting = pending !== live;

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Input Method')));

        const info = new PopupMenu.PopupMenuItem(waiting
            ? _('After login: %s').format(PROFILES[pending].label)
            : _('Current: %s').format(PROFILES[pending].label));
        info.sensitive = false;
        this.menu.addMenuItem(info);

        for (const target of [FCITX5, IBUS]) {
            if (target === pending)
                continue;
            const item = new PopupMenu.PopupMenuItem(_('Switch to %s').format(PROFILES[target].label));
            item.connect('activate', () => this._confirmSwitch(target));
            this.menu.addMenuItem(item);
        }

        if (waiting) {
            for (const [label, action] of [
                [_('Log out now'), 'logout'],
                [_('Restart now'), 'reboot'],
            ]) {
                const item = new PopupMenu.PopupMenuItem(label);
                item.connect('activate', () => this._confirmEndSession(action));
                this.menu.addMenuItem(item);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const tools = [
            [_('Fcitx 5 Config'), 'fcitx5-configtool'],
            [_('WowType Settings'), 'wowtype-config'],
        ];
        for (const [label, command] of tools) {
            if (GLib.find_program_in_path(command) === null)
                continue;
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                try {
                    const app = Gio.AppInfo.create_from_commandline(
                        command, null, Gio.AppInfoCreateFlags.NONE);
                    app.launch([], null);
                } catch (error) {
                    Main.notify(label, error.message);
                }
            });
            this.menu.addMenuItem(item);
        }

        if (pending === FCITX5) {
            const item = new PopupMenu.PopupMenuItem(_('Restart Fcitx 5'));
            item.connect('activate', () => {
                try {
                    Gio.Subprocess.new(['fcitx5', '-r', '-d'], Gio.SubprocessFlags.NONE);
                } catch (error) {
                    Main.notify(_('Failed to restart Fcitx 5'), error.message);
                }
            });
            this.menu.addMenuItem(item);
        }
    }

    _confirmSwitch(target) {
        try {
            const pending = pendingProfile(this._paths);
            if (target === pending) {
                Main.notify(_('Input Method Framework'), _('Already on %s').format(PROFILES[target].label));
                return;
            }

            if (target === FCITX5 && !fcitxInstalled()) {
                this._showNotInstalledDialog();
                return;
            }

            // 先落盘，再问要不要马上注销/重启
            applyProfile(this._paths, target);
            this._syncLabel();

            this._showDialog({
                title: _('Switched to %s').format(PROFILES[target].label),
                body: _('Log out or restart to apply the change.\nLog out now?'),
                buttons: [
                    {
                        label: _('Later'),
                        key: Clutter.KEY_Escape,
                        default: true,
                        action: dialog => dialog.close(),
                    },
                    {
                        label: _('Restart'),
                        action: dialog => {
                            dialog.close();
                            endSession('reboot', {
                                onError: message => Main.notify(_('Failed to restart'), message),
                            });
                        },
                    },
                    {
                        label: _('Log out'),
                        action: dialog => {
                            dialog.close();
                            endSession('logout', {
                                onError: message => Main.notify(_('Failed to log out'), message),
                            });
                        },
                    },
                ],
            });
        } catch (error) {
            // 出错了也要响一声，不能一点下去没反应
            console.error(`[im-switcher] switch failed: ${error.message}\n${error.stack}`);
            Main.notify(_('Failed to switch the input method framework'), error.message);
        }
    }

    _confirmEndSession(action) {
        const reboot = action === 'reboot';
        const title = reboot ? _('Restart') : _('Log out');
        this._showDialog({
            title,
            body: reboot ? _('Restart now?') : _('Log out now?'),
            buttons: [
                {
                    label: _('Later'),
                    key: Clutter.KEY_Escape,
                    default: true,
                    action: dialog => dialog.close(),
                },
                {
                    label: title,
                    action: dialog => {
                        dialog.close();
                        endSession(action, {
                            onError: message => Main.notify(
                                reboot ? _('Failed to restart') : _('Failed to log out'), message),
                        });
                    },
                },
            ],
        });
    }

    _showNotInstalledDialog() {
        this._showDialog({
            title: _('Fcitx 5 is not installed'),
            body: 'sudo dnf install fcitx5 fcitx5-configtool \\\n' +
                '  fcitx5-autostart fcitx5-gtk2 fcitx5-gtk3 \\\n' +
                '  fcitx5-gtk4 fcitx5-qt5 fcitx5-qt6\n\n' +
                'sudo dnf install ./wowtype-*.rpm\n' +
                'wowtype-config --add-to-group\n\n' +
                _('Install it first.'),
            buttons: [
                {
                    label: _('OK'),
                    key: Clutter.KEY_Escape,
                    default: true,
                    action: dialog => dialog.close(),
                },
            ],
        });
    }

    _showDialog({title, body, buttons}) {
        const dialog = new ModalDialog.ModalDialog();
        const box = boxLayout(true, {x_expand: true});
        box.add_child(new St.Label({
            style: 'font-weight: bold; font-size: 1.1em;',
            x_expand: true,
            text: title,
        }));
        box.add_child(new St.Label({
            style: 'margin-top: 10px;',
            x_expand: true,
            text: body,
        }));
        dialog.contentLayout.add_child(box);

        for (const {label, action, key, default: isDefault} of buttons) {
            dialog.addButton({
                label,
                key,
                default: isDefault,
                action: () => action(dialog),
            });
        }
        dialog.open();
    }
});

export default class IMSwitcherExtension extends Extension {
    enable() {
        this._paths = pathsFor(GLib.get_home_dir());
        this._indicator = new IMSwitcherIndicator(this._paths);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        // CI 靠这一行确认扩展真的加载起来了
        console.log(`[im-switcher] enabled, framework=${pendingProfile(this._paths)}`);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        console.log('[im-switcher] disabled');
    }
}
