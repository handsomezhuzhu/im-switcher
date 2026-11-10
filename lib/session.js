/*
 * lib/session.js — 注销 / 重启（纯逻辑，可注入依赖以便测试）
 *
 * 走 org.gnome.SessionManager，失败时退回命令行工具。
 * 之所以不直接用 GNOME Shell 内部 API：那些没有稳定的公开入口，
 * 而 SessionManager 的 D-Bus 接口从 GNOME 3 到现在一直没变。
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEST = 'org.gnome.SessionManager';
const PATH = '/org/gnome/SessionManager';
const IFACE = 'org.gnome.SessionManager';

// logout 的 mode 1 = 不弹 gnome 自己的确认框（我们自己弹过了）
function parametersFor(action) {
    return action === 'reboot' ? null : new GLib.Variant('(u)', [1]);
}

function fallbackArgv(action) {
    return action === 'reboot'
        ? ['systemctl', 'reboot']
        : ['gnome-session-quit', '--logout', '--no-prompt'];
}

/**
 * @param {'logout'|'reboot'} action
 * @param {object} [deps]
 * @param {(argv: string[]) => void} [deps.spawn]  默认 Gio.Subprocess.new
 * @param {(message: string) => void} [deps.onError] 默认 console.error
 */
export function endSession(action, deps = {}) {
    const spawn = deps.spawn ?? (argv => Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE));
    const onError = deps.onError ?? (message => console.error(`[im-switcher] ${message}`));

    Gio.DBus.session.call(
        DEST, PATH, IFACE,
        action === 'reboot' ? 'Reboot' : 'Logout',
        parametersFor(action),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (connection, result) => {
            try {
                connection.call_finish(result);
            } catch (error) {
                onError(`${action} failed: ${error.message}`);
                try {
                    spawn(fallbackArgv(action));
                } catch (subprocessError) {
                    onError(`${action} fallback failed: ${subprocessError.message}`);
                }
            }
        });
}
