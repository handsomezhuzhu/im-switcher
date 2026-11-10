#!/usr/bin/env bash
# ci-shell-test.sh — 在无头 GNOME Shell 里真加载扩展，抓 JS 错误
#
# 这是整个 CI 里最有价值的一步：像之前 St.BoxLayout.vertical 被删那种
# "语法没错、一跑就崩"的问题，只有真加载一次才能发现。
#
# 本地也能跑（Fedora + dbus + gnome-shell 就够，不需要 Xvfb）：
#     ./scripts/ci-shell-test.sh
#
# 退出码 0 = 加载成功且没有报错。

set -euo pipefail

UUID="im-switcher@handsomezhuzhu.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 用一个干净的 HOME：不加载用户自己的扩展和配置，结果可复现
export HOME="$(mktemp -d)"
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
export G_MESSAGES_DEBUG=all
unset WAYLAND_DISPLAY DISPLAY || true

DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
cp "$ROOT/extension.js" "$ROOT/metadata.json" "$DEST/"
cp -r "$ROOT/lib" "$DEST/"
for po in "$ROOT"/po/*.po; do
    [ -e "$po" ] || continue
    lang="$(basename "$po" .po)"
    mkdir -p "$DEST/locale/$lang/LC_MESSAGES"
    msgfmt -o "$DEST/locale/$lang/LC_MESSAGES/im-switcher.mo" "$po"
done

echo "==> 已装到 $DEST"

# 写一个"当前框架"标记，顺便验证扩展读状态这条路
mkdir -p "$HOME/.config/im-switcher"
printf 'fcitx5\n' > "$HOME/.config/im-switcher/framework"

LOG="$HOME/shell.log"
# --headless：mutter 的无头后端，不开窗口、不碰显示器，输出全进日志
# dbus-run-session：给这条 shell 一条独立的会话总线，免得和桌面上的抢名字
echo "==> 写框架标记（顺便验证扩展读状态这条路）"
mkdir -p "$HOME/.config/im-switcher"
printf 'fcitx5\n' > "$HOME/.config/im-switcher/framework"

LOG="$HOME/shell.log"
# 注意：gsettings/dconf 的写入必须走会话总线，否则静默丢失（dconf 服务不在）。
# 所以"启用扩展"和"起 shell"放在同一个 dbus-run-session 里：
#   python 先 gsettings set，再 exec gnome-shell，shell 的输出直接进日志。
# --headless：mutter 的无头后端，不开窗口、不碰显示器
# dbus-run-session：一条独立的会话总线，免得和桌面上的 shell 抢名字
echo "==> 起无头 GNOME Shell（最多 ${SHELL_TIMEOUT:-60} 秒）"
timeout "${SHELL_TIMEOUT:-60}" dbus-run-session -- python3 - "$UUID" <<'PY' >"$LOG" 2>&1 || true
import ast, os, subprocess, sys

uuid = sys.argv[1]

def enabled_list():
    out = subprocess.check_output(
        ['gsettings', 'get', 'org.gnome.shell', 'enabled-extensions'],
        text=True, stderr=subprocess.DEVNULL)
    # 只认含方括号的行：G_MESSAGES_DEBUG=all 会让 GLib 往输出里塞调试行
    candidates = [l.strip() for l in out.splitlines() if '[' in l and ']' in l]
    if not candidates:
        raise RuntimeError(f'gsettings 没返回列表，原始输出: {out!r}')
    line = candidates[-1]
    # GVariant 文本格式可能带类型前缀（Ubuntu 的 GLib 输出 "@as []"，Fedora 输出 "[]"）
    if line.startswith('@') and '[' in line:
        line = line[line.index('['):]
    return ast.literal_eval(line)

lst = enabled_list()
print('==> 启用前:', lst, flush=True)
if uuid not in lst:
    lst.append(uuid)
    subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                    '[' + ', '.join("'%s'" % x for x in lst) + ']'], check=True)
    print('==> 启用后:', enabled_list(), flush=True)
else:
    print('==> 本来就在启用列表里', flush=True)

os.execvp('gnome-shell', ['gnome-shell', '--headless', '--no-x11'])
PY

echo
echo "===== 本扩展的日志 ====="
grep -i "im-switcher" "$LOG" || echo "(一行都没有)"

echo
echo "===== 断言 ====="
rc=0

dump_log() {
    echo
    echo "===== shell 日志末尾 80 行（排查用） ====="
    tail -80 "$LOG" 2>/dev/null || echo "(读不到日志)"
}

if ! grep -q '\[im-switcher\] enabled, framework=' "$LOG"; then
    echo "::error::扩展没有被加载（日志里没有 enabled 那行）"
    dump_log
    rc=1
else
    echo "  ok   扩展加载成功"
fi

if grep -i "im-switcher" "$LOG" | grep -iE "error|exception|warning"; then
    echo "::error::扩展加载过程中有报错"
    grep -i "im-switcher" "$LOG" | grep -iE "error|exception|warning"
    dump_log
    rc=1
else
    echo "  ok   没有报错"
fi

# 顶栏按钮加没加上，看 shell 有没有抱怨 actor
if grep -i "im-switcher" "$LOG" | grep -iE "allocation|needs an"; then
    echo "::warning::有布局相关警告（一般是无害的）"
fi

echo
echo "完整日志：$LOG"
exit $rc
