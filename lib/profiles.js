/*
 * lib/profiles.js — 输入法框架的状态与配置读写（纯逻辑）
 *
 * 只依赖 GLib / Gio，不 import 任何 GNOME Shell 模块，
 * 所以能在 CI 里用 gjs 直接跑单元测试（见 tests/）。
 *
 * 为什么配置要写两处：
 *   1. ~/.config/environment.d/im-switcher.conf
 *      systemd 用户管理器读取，决定它拉起的进程的环境。
 *   2. ~/.config/im-switcher/framework
 *      ~/.bash_profile 里的片段读取。之所以还需要这一处：gnome-session 在 Wayland 下
 *      会以登录 shell 重新 exec 自己，/etc/profile.d/fcitx5.sh（fcitx5 的 RPM 自带）
 *      会把 GTK_IM_MODULE 等四个变量无条件设成 fcitx，把 environment.d 整个覆盖掉。
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const FCITX5 = 'fcitx5';
export const IBUS = 'ibus';

export const PROFILES = {
    [FCITX5]: {
        label: 'Fcitx5',
        env: [
            '# Written by im-switcher: input method framework = fcitx5',
            '# Delete this file to restore the GNOME default (ibus)',
            'GTK_IM_MODULE=fcitx',
            'QT_IM_MODULE=fcitx',
            'QT_IM_MODULES=fcitx;wayland',
            'XMODIFIERS=@im=fcitx',
            '',
        ].join('\n'),
    },
    [IBUS]: {
        label: 'IBus',
        // null = 删掉 environment.d 里的配置文件
        env: null,
    },
};

export function pathsFor(home) {
    return {
        home,
        envDir: `${home}/.config/environment.d`,
        envFile: `${home}/.config/environment.d/im-switcher.conf`,
        markerDir: `${home}/.config/im-switcher`,
        markerFile: `${home}/.config/im-switcher/framework`,
        autostartSys: '/etc/xdg/autostart/org.fcitx.Fcitx5.desktop',
        autostartUser: `${home}/.config/autostart/org.fcitx.Fcitx5.desktop`,
    };
}

/** 从 GTK_IM_MODULE 的值判断当前会话实际在用的框架 */
export function profileFromEnvValue(value) {
    return value === 'fcitx' ? FCITX5 : IBUS;
}

// 读文件走异步：shell 进程里不该做同步文件 IO（EGO-X-004）。
// 文件不存在是正常情况（没切过），不当错误处理。
export function readTextFileAsync(path, callback) {
    Gio.File.new_for_path(path).load_contents_async(null, (source, result) => {
        try {
            const [ok, bytes] = source.load_contents_finish(result);
            callback(ok ? new TextDecoder().decode(bytes) : null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`[im-switcher] cannot read ${path}: ${error.message}`);
            callback(null);
        }
    });
}

function makeParentDir(file) {
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
    }
}

export function writeTextFile(path, text) {
    const file = Gio.File.new_for_path(path);
    makeParentDir(file);
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

export function deleteIfExists(path) {
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null))
        file.delete(null);
}

/** 配置里写的是哪个框架（切完立刻就是这个值，但要重登才真正生效） */
export function pendingProfileAsync(paths, callback) {
    readTextFileAsync(paths.markerFile, marker => {
        if (marker !== null) {
            const value = marker.trim();
            if (value === FCITX5 || value === IBUS) {
                callback(value);
                return;
            }
        }
        // 没有标记文件时退回看 environment.d（兼容旧版本留下的状态）
        readTextFileAsync(paths.envFile, text => {
            const fcitx = text !== null &&
                /^\s*GTK_IM_MODULE\s*=\s*fcitx\s*$/m.test(text);
            callback(fcitx ? FCITX5 : IBUS);
        });
    });
}

/** 切换：写配置 + 写标记文件 + 处理 fcitx5 自启动 */
export function applyProfile(paths, target) {
    const {env} = PROFILES[target];
    if (env === null)
        deleteIfExists(paths.envFile);
    else
        writeTextFile(paths.envFile, env);

    // 标记文件给 ~/.bash_profile 的片段用，覆盖 /etc/profile.d/fcitx5.sh
    writeTextFile(paths.markerFile, `${target}\n`);

    setFcitxAutostart(paths, target === FCITX5);
}

// 切到 ibus 时压掉 fcitx5 的自启动，免得两个框架的后台互相抢快捷键。
//
// 实现要点（踩过坑）：这个文件必须是「完整的合法桌面项」。
// gnome-session 的 load_standard_apps() 先扫 ~/.config/autostart 再扫
// /etc/xdg/autostart，两个目录里的同名文件按 app-id 去重（gsm-manager.c 的
// append_app），先注册的赢；被 Hidden/禁用的 app 仍然占着 id，只在启动时跳过。
// 所以只要用户目录里这份能加载，系统那份就会被当重复挡掉。
// 反过来说：文件缺 Type/Name 这类必填字段时 GLib 会整个拒绝加载
// （g_desktop_app_info_new_from_filename 返回 NULL），app 压根没注册，
// 系统那份就会正常跑起来 —— 只写一个 Hidden=true 是没用的。
const FCITX_AUTOSTART_OVERRIDE = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Fcitx 5 (disabled by im-switcher)',
    // 真被执行也不要紧，true 什么都不做
    'Exec=true',
    'Hidden=true',
    'X-GNOME-Autostart-enabled=false',
    '',
].join('\n');

export function setFcitxAutostart(paths, enabled) {
    if (!GLib.file_test(paths.autostartSys, GLib.FileTest.EXISTS))
        return;
    const file = Gio.File.new_for_path(paths.autostartUser);
    if (enabled) {
        deleteIfExists(paths.autostartUser);
    } else {
        makeParentDir(file);
        file.replace_contents(
            new TextEncoder().encode(FCITX_AUTOSTART_OVERRIDE),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }
}

/** fcitx5 框架装没装（没装时切过去会没有输入法可用） */
export function fcitxInstalled() {
    return GLib.find_program_in_path('fcitx5') !== null ||
        GLib.file_test('/usr/lib64/fcitx5', GLib.FileTest.IS_DIR) ||
        GLib.file_test('/usr/lib/fcitx5', GLib.FileTest.IS_DIR);
}
