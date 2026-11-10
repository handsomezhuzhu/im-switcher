# ---- im-switcher: input method framework ----
# Managed by im-switcher (https://github.com/handsomezhuzhu/im-switcher) — do not edit by hand.
#
# gnome-session re-execs itself through a login shell on Wayland, and
# /etc/profile.d/fcitx5.sh (shipped by the fcitx5 RPM) unconditionally exports
# GTK_IM_MODULE=fcitx & friends, overriding whatever ~/.config/environment.d says.
# This snippet runs after it, so it wins.
if [ -r "$HOME/.config/im-switcher/framework" ]; then
    case "$(cat "$HOME/.config/im-switcher/framework" 2>/dev/null)" in
        fcitx5)
            export INPUT_METHOD=fcitx GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx
            ;;
        ibus)
            export INPUT_METHOD=ibus GTK_IM_MODULE=ibus QT_IM_MODULE=ibus XMODIFIERS=@im=ibus
            ;;
    esac
fi
# ---- im-switcher: end ----
