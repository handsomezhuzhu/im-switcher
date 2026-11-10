#!/usr/bin/env bash
# build-zip.sh — 打出能直接上传到 extensions.gnome.org 的 zip
#
# zip 根目录直接放扩展文件（metadata.json 在根上），和 EGO 上其它扩展一致。

set -euo pipefail

UUID="im-switcher@handsomezhuzhu.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/im-switcher.zip"

command -v zip >/dev/null || { echo "缺少 zip，先：sudo dnf install zip" >&2; exit 1; }
command -v msgfmt >/dev/null || { echo "缺少 gettext（msgfmt），先：sudo dnf install gettext" >&2; exit 1; }

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

echo "==> 组装 $UUID"
mkdir -p "$BUILD/$UUID"
cp "$ROOT/extension.js" "$ROOT/metadata.json" "$BUILD/$UUID/"
cp -r "$ROOT/lib" "$BUILD/$UUID/"

echo "==> 编译翻译"
mkdir -p "$BUILD/$UUID/locale"
found=0
for po in "$ROOT"/po/*.po; do
    [ -e "$po" ] || continue
    lang="$(basename "$po" .po)"
    mkdir -p "$BUILD/$UUID/locale/$lang/LC_MESSAGES"
    msgfmt -o "$BUILD/$UUID/locale/$lang/LC_MESSAGES/im-switcher.mo" "$po"
    echo "    $lang"
    found=1
done
[ "$found" = 1 ] || { rmdir "$BUILD/$UUID/locale"; echo "    （没有 .po，只有英文）"; }

echo "==> 打包"
rm -f "$OUT"
(cd "$BUILD/$UUID" && zip -qr "$OUT" .)

echo
echo "完成：$OUT"
echo "上传到 https://extensions.gnome.org/upload/ 即可。"
unzip -l "$OUT"
