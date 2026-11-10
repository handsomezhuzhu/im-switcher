# im-switcher

Switch the GNOME input method framework — **IBus ⇄ Fcitx5** — from the top panel.

Click the keyboard icon → *Switch to Fcitx5* → the config is written immediately → a
dialog offers restart / log out now or later. Until you do, the panel label reads
`After login: Fcitx5`, so it never lies to you.

**[中文](README.zh-CN.md)**

## Install

```bash
git clone https://github.com/handsomezhuzhu/im-switcher.git
cd im-switcher
./scripts/install.sh          # uninstall: ./scripts/install.sh --uninstall
```

Log out and back in once — GNOME Shell never hot-reloads extension code.
Needs `gjs` and `gettext`; no root.

## How it works

gnome-session re-execs itself through a login shell on Wayland, and
`/etc/profile.d/fcitx5.sh` (shipped by the fcitx5 RPM) unconditionally exports
`GTK_IM_MODULE=fcitx`, overriding `~/.config/environment.d`. So the config is written
twice:

| File | Read by |
|---|---|
| `~/.config/environment.d/im-switcher.conf` | systemd user manager |
| `~/.config/im-switcher/framework` | a snippet in `~/.bash_profile`, appended by the installer |

Switching to IBus also drops a `Hidden=true` override for fcitx5's autostart, so the
two daemons don't fight over hotkeys.

## Test

```bash
./tests/run.sh                  # unit tests, gjs only, ~2s
./scripts/ci-shell-test.sh      # load the extension in a headless GNOME Shell
```

The second one needs a real mutter compositor, so run it on a real machine — GitHub's
containers can't host one:

```bash
instabox ssh mybox -- 'sudo apt install -y gnome-shell gjs gettext'
instabox ssh mybox -- 'git clone https://github.com/handsomezhuzhu/im-switcher.git \
  && cd im-switcher && SHELL_TIMEOUT=60 bash scripts/ci-shell-test.sh'
```

Verified on Fedora 45 / GNOME 51 and Ubuntu 24.04 / GNOME 46.

## Translations

English source strings wrapped in `_()`; Chinese lives in `po/zh_CN.po`. After adding
new strings, run `./scripts/update-pot.sh`.

## Publish

```bash
./scripts/build-zip.sh          # produces im-switcher.zip
```

Upload it at <https://extensions.gnome.org/upload/>. Keep `shell-version` in
`metadata.json` covering the current GNOME — under-declaring it is the #1 cause of
"installed but does nothing" on EGO.

Note: `shexli` (EGO's static analyzer) reports `EGO-M-004` on `shell-version` here
because it hard-codes "major > 50" as a future release. GNOME 51 is out and EGO
accepts it — don't drop the entry to silence the linter.

## CLI

```bash
echo fcitx5 > ~/.config/im-switcher/framework   # or ibus
gnome-session-quit --logout --no-prompt
```

## License

MIT
