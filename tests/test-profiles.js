/*
 * tests/test-profiles.js — lib/profiles.js 的单元测试
 *
 * 跑法：gjs -m tests/test-profiles.js   （或 ./tests/run.sh）
 * 不依赖 GNOME Shell，所以在 CI 里也能跑。
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {
    FCITX5,
    IBUS,
    PROFILES,
    applyProfile,
    pathsFor,
    pendingProfileAsync,
    profileFromEnvValue,
    setFcitxAutostart,
} from '../lib/profiles.js';

let passed = 0;
let failed = 0;

function check(name, got, want) {
    if (got === want) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
}

function section(name) {
    console.log(`\n${name}`);
}

// 包一层 Promise，测试里就能直接 await
const readFile = path => new Promise(resolve => {
    import('../lib/profiles.js').then(({readTextFileAsync}) =>
        readTextFileAsync(path, resolve));
});
const pendingOf = paths => new Promise(resolve =>
    pendingProfileAsync(paths, resolve));

// 覆盖文件必须是 GLib 能加载的合法桌面项，否则 gnome-session 压根不注册它，
// 系统 /etc/xdg/autostart 那份就会正常跑起来（真实踩过的坑）。
function desktopEntryLoads(path) {
    const AppInfo = Gio.DesktopAppInfo ?? GioUnix?.DesktopAppInfo;
    if (!AppInfo)
        return true; // 这台机器没有这个 API，跳过
    try {
        const app = AppInfo.new_from_filename(path);
        return app !== null && app.get_is_hidden();
    } catch (error) {
        return false;
    }
}

// 每个测试用一个全新的临时 HOME，互不影响
const tmpHomes = [];

function rmRf(path) {
    const file = Gio.File.new_for_path(path);
    try {
        const iter = file.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            const child = file.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                rmRf(child.get_path());
            else
                child.delete(null);
        }
        file.delete(null);
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            throw error;
    }
}

function freshPaths() {
    const home = GLib.dir_make_tmp('im-switcher-test-XXXXXX');
    tmpHomes.push(home);
    const paths = pathsFor(home);
    // 把系统 autostart 也指到临时目录，免得读真系统
    paths.autostartSys = `${home}/etc-xdg-autostart/org.fcitx.Fcitx5.desktop`;
    return paths;
}

async function run() {
    section('profileFromEnvValue');
    check('fcitx -> fcitx5', profileFromEnvValue('fcitx'), FCITX5);
    check('ibus -> ibus', profileFromEnvValue('ibus'), IBUS);
    check('空值 -> ibus', profileFromEnvValue(null), IBUS);
    check('空串 -> ibus', profileFromEnvValue(''), IBUS);

    section('初始状态（没切过）');
    {
        const paths = freshPaths();
        check('pendingProfile = ibus', await pendingOf(paths), IBUS);
        check('标签 = IBus', PROFILES[await pendingOf(paths)].label, 'IBus');
    }

    section('切到 fcitx5');
    {
        const paths = freshPaths();
        applyProfile(paths, FCITX5);
        check('pendingProfile = fcitx5', await pendingOf(paths), FCITX5);
        check('标签 = Fcitx5', PROFILES[await pendingOf(paths)].label, 'Fcitx5');

        const text = await readFile(paths.envFile);
        check('environment.d 里有 GTK_IM_MODULE=fcitx', /^GTK_IM_MODULE=fcitx$/m.test(text), true);
        check('environment.d 里有 XMODIFIERS', /^XMODIFIERS=@im=fcitx$/m.test(text), true);

        const marker = await readFile(paths.markerFile);
        check('标记文件 = fcitx5', marker.trim(), FCITX5);
    }

    section('切到 ibus');
    {
        const paths = freshPaths();
        applyProfile(paths, FCITX5);
        applyProfile(paths, IBUS);
        check('pendingProfile = ibus', await pendingOf(paths), IBUS);
        check('environment.d 配置文件已删', GLib.file_test(paths.envFile, GLib.FileTest.EXISTS), false);
        const marker = await readFile(paths.markerFile);
        check('标记文件 = ibus', marker.trim(), IBUS);
    }

    section('标记文件优先于 environment.d');
    {
        const paths = freshPaths();
        applyProfile(paths, FCITX5);
        // 标记说 ibus，environment.d 却还是 fcitx —— 应该听标记的
        applyProfile(paths, IBUS);
        GLib.file_set_contents(paths.envFile, new TextEncoder().encode(PROFILES[FCITX5].env));
        check('以标记文件为准', await pendingOf(paths), IBUS);
    }

    section('fcitx5 自启动的 Hidden 覆盖');
    {
        const paths = freshPaths();
        GLib.mkdir_with_parents(GLib.path_get_dirname(paths.autostartSys), 0o755);
        GLib.file_set_contents(paths.autostartSys,
            new TextEncoder().encode('[Desktop Entry]\nName=Fcitx 5\n'));

        setFcitxAutostart(paths, false);
        const hidden = await readFile(paths.autostartUser);
        check('写了 Hidden=true', hidden.includes('Hidden=true'), true);
        check('是完整桌面项（Type/Name/Exec 齐全）',
            /^Type=Application$/m.test(hidden) &&
            /^Name=/m.test(hidden) &&
            /^Exec=/m.test(hidden), true);
        check('GLib 能加载它且视为隐藏', desktopEntryLoads(paths.autostartUser), true);

        setFcitxAutostart(paths, true);
        check('切回 fcitx5 时删掉覆盖',
            GLib.file_test(paths.autostartUser, GLib.FileTest.EXISTS), false);

        // 系统没装 fcitx5-autostart 时不能炸
        GLib.unlink(paths.autostartSys);
        setFcitxAutostart(paths, false);
        check('系统无 autostart 时不报错', 'ok', 'ok');
    }

    section('反复切换');
    {
        const paths = freshPaths();
        for (const target of [FCITX5, IBUS, FCITX5, IBUS, FCITX5]) {
            applyProfile(paths, target);
            if (await pendingOf(paths) !== target) {
                failed++;
                console.log(`  FAIL 切到 ${target} 后读回来不对`);
                break;
            }
        }
        passed++;
        console.log('  ok   fcitx5/ibus 来回切五次，状态都对');
    }

    console.log(`\n${passed} 项通过，${failed} 项失败`);

    for (const home of tmpHomes)
        rmRf(home);
}

const loop = new GLib.MainLoop(null, false);
run().then(() => loop.quit()).catch(error => {
    console.error(error);
    loop.quit();
    System.exit(1);
});
loop.run();
