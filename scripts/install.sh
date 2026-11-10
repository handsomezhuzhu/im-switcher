#!/usr/bin/env bash
# install.sh — 把 im-switcher 装进当前用户，或卸载
#
#   ./scripts/install.sh              安装
#   ./scripts/install.sh --uninstall  卸载
#
# 不需要 root：全部装在 $HOME 下面。

set -euo pipefail

UUID="im-switcher@handsomezhuzhu.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
BEGIN_MARKER="# ---- im-switcher: input method framework ----"
END_MARKER="# ---- im-switcher: end ----"

compile_locale() {
    local dest="$1"
    [ -d "$ROOT/po" ] || return 0
    local po lang
    for po in "$ROOT"/po/*.po; do
        [ -e "$po" ] || continue
        lang="$(basename "$po" .po)"
        mkdir -p "$dest/locale/$lang/LC_MESSAGES"
        msgfmt -o "$dest/locale/$lang/LC_MESSAGES/im-switcher.mo" "$po"
    done
}

set_enabled() {
    local uuid="$1" want="$2"
    python3 - "$uuid" "$want" <<'PY'
import ast, subprocess, sys
uuid, want = sys.argv[1], sys.argv[2] == 'yes'
key = 'org.gnome.shell'
out = subprocess.check_output(['gsettings', 'get', key, 'enabled-extensions'],
                              text=True, stderr=subprocess.DEVNULL)
# 只认含方括号的行；GVariant 可能带 "@as " 类型前缀（Ubuntu）或没有（Fedora）
candidates = [l.strip() for l in out.splitlines() if '[' in l and ']' in l]
if not candidates:
    sys.exit(f'gsettings 没返回列表，原始输出: {out!r}')
line = candidates[-1]
if line.startswith('@') and '[' in line:
    line = line[line.index('['):]
lst = [x for x in ast.literal_eval(line) if x != uuid]
if want:
    lst.append(uuid)
subprocess.run(['gsettings', 'set', key, 'enabled-extensions',
                '[' + ', '.join("'%s'" % x for x in lst) + ']'], check=True)
print(f'  enabled-extensions -> {lst}')
PY
}

install() {
    command -v msgfmt >/dev/null || { echo "缺少 gettext（msgfmt），先：sudo dnf install gettext" >&2; exit 1; }

    echo "==> 复制文件到 $DEST"
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp "$ROOT/extension.js" "$ROOT/metadata.json" "$DEST/"
    cp -r "$ROOT/lib" "$DEST/"

    echo "==> 编译翻译"
    compile_locale "$DEST"
    ls "$DEST"/locale/*/LC_MESSAGES/*.mo 2>/dev/null | sed 's/^/    /' || echo "    （没有 .po，只有英文）"

    echo "==> 补 ~/.bash_profile 里的环境变量片段"
    # /etc/profile.d/fcitx5.sh 会把 GTK_IM_MODULE 等设回 fcitx，
    # 把 environment.d 的结果覆盖掉，所以要在它之后再压一次
    if grep -qF "$BEGIN_MARKER" "$HOME/.bash_profile" 2>/dev/null; then
        echo "    已经有了，跳过"
    else
        [ -f "$HOME/.bash_profile" ] || : > "$HOME/.bash_profile"
        printf '\n' >> "$HOME/.bash_profile"
        cat "$ROOT/data/bash-profile-snippet.sh" >> "$HOME/.bash_profile"
        echo "    已追加（用 --uninstall 可以撤掉）"
    fi

    echo "==> 加入 GNOME Shell 启用列表"
    set_enabled "$UUID" yes

    cat <<EOF

装好了。注意两点：

  1. GNOME Shell 不会热重载扩展代码，**注销重登**后才会加载。
  2. 切换框架时，本扩展靠上面那个 ~/.bash_profile 片段压住
     /etc/profile.d/fcitx5.sh，所以它也必须在登录时被 source 到
     （用的是你 passwd 里的登录 shell：$(getent passwd "$USER" | cut -d: -f7)）。

想切回/卸载：./scripts/install.sh --uninstall
EOF
}

uninstall() {
    echo "==> 删除 $DEST"
    rm -rf "$DEST"

    echo "==> 从启用列表移除"
    set_enabled "$UUID" no

    echo "==> 撤掉 ~/.bash_profile 里的片段"
    if [ -f "$HOME/.bash_profile" ] && grep -qF "$BEGIN_MARKER" "$HOME/.bash_profile"; then
        sed -i "\|^$BEGIN_MARKER\$|,\|^$END_MARKER\$|d" "$HOME/.bash_profile"
        # 清掉可能留下的空行堆积
        sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$HOME/.bash_profile"
        echo "    已删除"
    else
        echo "    本来就没有"
    fi

    cat <<EOF

卸载完成。这些没动，按需手动清理：

    rm -rf ~/.config/im-switcher                                  # 框架标记文件
    rm -f  ~/.config/environment.d/im-switcher.conf               # environment.d 配置
    rm -f  ~/.config/autostart/org.fcitx.Fcitx5.desktop           # 被 Hidden 盖住的 fcitx5 自启动

恢复 GNOME 默认（ibus）的话，把 ~/.config/im-switcher/framework 写成 ibus 再注销重登。
EOF
}

case "${1:-}" in
    --uninstall) uninstall ;;
    "") install ;;
    *) echo "用法：$0 [--uninstall]" >&2; exit 1 ;;
esac
