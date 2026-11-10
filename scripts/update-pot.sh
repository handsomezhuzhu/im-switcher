#!/usr/bin/env bash
# update-pot.sh — 从源码重新生成翻译模板，并合并进各 .po
#
# 加了新的 _("...") 之后跑一次，然后补 po/zh_CN.po 里新的空条目。

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v xgettext >/dev/null || { echo "缺少 gettext，先：sudo dnf install gettext" >&2; exit 1; }

echo "==> 生成 po/im-switcher.pot"
xgettext --from-code=UTF-8 \
         --language=JavaScript \
         --keyword=_ \
         --add-comments \
         --package-name="im-switcher" \
         --output=po/im-switcher.pot \
         --files-from=po/POTFILES.in

echo "==> 合并进各翻译"
for po in po/*.po; do
    [ -e "$po" ] || continue
    [ "$(basename "$po")" = "im-switcher.pot" ] && continue
    msgmerge -U "$po" po/im-switcher.pot
    # 顺手校验语法
    msgfmt --check -o /dev/null "$po"
    echo "    $(basename "$po") OK"
done

echo
echo "完事。新条目在 po/zh_CN.po 里是空的，补上翻译即可。"
