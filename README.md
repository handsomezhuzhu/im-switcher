# im-switcher

Switch the GNOME input method framework — **IBus ⇄ Fcitx5** — from the top panel.

Click the keyboard icon → *Switch to Fcitx5* → the config is written immediately →
a dialog asks whether to restart / log out **now** or **later**. Pick "Later" and the
menu keeps *Log out now* / *Restart now* around for whenever you're ready, while the
panel label reads `After login: Fcitx5` so it never lies to you.

**[中文](README.zh-CN.md)** · [GNOME Extensions](https://extensions.gnome.org/extension/0000/im-switcher/)

## Why

Fedora and Ubuntu ship IBus by default, while Fcitx5 is what unlocks the
WeChat-input-method class of experience ([WowType](https://github.com/Gloridust/WowType),
rime-ice, …). Both frameworks can be installed side by side, but only one is active per
session, and the official way to switch is always *"edit environment variables → log
out"* — easy to forget where to edit, easy to forget to log out. This extension turns
that into one click.

## Install

```bash
git clone https://github.com/handsomezhuzhu/im-switcher.git
cd im-switcher
./scripts/install.sh          # uninstall: ./scripts/install.sh --uninstall
```

No root required — everything lives under `$HOME`. **Log out and back in once**
afterwards (GNOME Shell never hot-reloads extension code).

Requirements: `gjs` and `gettext` (for building the translations).

```bash
sudo dnf install gjs gettext      # Fedora
sudo apt install gjs gettext      # Ubuntu / Debian
```

## How the switch actually sticks

This is the only part with any real depth, and it cost two war wounds:

**Pitfall 1 — `~/.config/environment.d/` alone is not enough.**
On Wayland, gnome-session **re-execs itself through a login shell**
(`maybe_reexec_with_login_shell()` in `gnome-session/gnome-session/leader-main.c`),
which sources `/etc/profile.d/fcitx5.sh` — shipped by the fcitx5 RPM — and that file
unconditionally exports `GTK_IM_MODULE=fcitx` & friends, **overriding** whatever
environment.d wrote.

**Pitfall 2 — environment variables alone are not enough either.**
When you switch to IBus but fcitx5 keeps auto-starting, both frameworks' daemons run
and fight over the same global hotkeys. So the extension also drops
`~/.config/autostart/org.fcitx.Fcitx5.desktop` with `Hidden=true` to suppress the
fcitx5 autostart, and removes that override when you switch back.

Hence two config locations, both required:

| File | Read by |
|---|---|
| `~/.config/environment.d/im-switcher.conf` | the systemd user manager |
| `~/.config/im-switcher/framework` | a snippet in `~/.bash_profile` (appended by the installer, marked, cleanly removable) |

The `~/.bash_profile` snippet runs **after** `/etc/profile.d/fcitx5.sh`, so it wins.

## Layout

```
extension.js          top-bar icon, menu, dialogs — English source + gettext
lib/profiles.js       framework state on disk (pure logic, GLib/Gio only)
lib/session.js        log out / restart via org.gnome.SessionManager, CLI fallback
metadata.json         extension metadata (UUID, supported Shell versions, gettext domain)
data/                 the ~/.bash_profile snippet
scripts/              install.sh · build-zip.sh · update-pot.sh · ci-shell-test.sh
tests/                gjs unit tests, no GNOME Shell needed
po/                   translation template and languages
.github/workflows/    CI
```

Splitting pure logic from the GNOME Shell dependency is what makes `lib/` testable
with plain `gjs` in CI.

## Testing

```bash
./tests/run.sh                  # unit tests (gjs only)
./scripts/ci-shell-test.sh      # load the extension in a headless GNOME Shell
```

The second one is the point: it installs the extension into a throwaway `$HOME`,
starts a private session bus with `dbus-run-session`, runs
`gnome-shell --headless --no-x11` (mutter's headless backend — no window, no display),
then asserts that

- the log contains `[im-switcher] enabled, framework=...`
- no `im-switcher`-related error or warning appears

Real bugs it caught during development:

- `St.BoxLayout`'s `vertical` property was removed in GNOME 48 (replaced by
  `orientation`) — invisible to any syntax check, fatal at load time
- `Gio.File.load_contents()` returns `[ok, bytes]`, not a single value
- `gsettings set` **silently loses its write when no session bus is running**
  (dconf's service isn't there), which is why the enable step lives inside the
  `dbus-run-session`
- GVariant's text format is `@as []` on Ubuntu's GLib but `[]` on Fedora's —
  the old parser crashed on Debian-family systems
- GNOME 46 still uses `vertical` while 48+ uses `orientation`, so a single
  hard-coded choice breaks half the supported range

**Where to run it:** on a real machine — your laptop, a VM, or a cloud box. It needs
`gnome-shell`, `gjs`, `gettext` and `dbus`; no X server, no GPU, no display:

```bash
# on an instabox sandbox (Ubuntu 24.04 / GNOME 46)
instabox ssh mybox -- 'sudo apt install -y gnome-shell gjs gettext'
instabox ssh mybox -- 'git clone https://github.com/handsomezhuzhu/im-switcher.git \
  && cd im-switcher && SHELL_TIMEOUT=60 bash scripts/ci-shell-test.sh'
```

Verified on Fedora 45 / GNOME 51.1 and Ubuntu 24.04 / GNOME 46.

**Why it is not a GitHub Actions job:** it needs a real mutter compositor. GitHub's
containers have no GPU, no seat and no logind, and `gnome-shell --headless` exits
silently (code 0, no error) right after creating the software renderer — an
environment limitation, not a code problem. CI here covers static checks only; the unit
tests and this load test run locally or on a real machine.

## Translations

Source strings are English and wrapped in `_()`; `po/zh_CN.po` provides Chinese.
The installer runs `msgfmt` to build `.mo` files into the extension's `locale/`
directory, where GNOME Shell's `initTranslations()` picks them up automatically.

```bash
./scripts/update-pot.sh     # run after adding new _("...") strings
```

## Publishing to GNOME Extensions

1. Push to a GitHub repo (the `url` in `metadata.json` already points at
   `handsomezhuzhu/im-switcher`)
2. `./scripts/build-zip.sh` produces `im-switcher.zip`
3. Upload it at <https://extensions.gnome.org/upload/>
4. Once reviewed you get an extension page; new releases are just a re-pack and upload

The zip root holds the extension files directly (`metadata.json` at the root), matching
what EGO expects. The one thing that bites people: `shell-version` must cover the
current GNOME. Code that is fine but under-declared is the #1 cause of "installed but
does nothing" on EGO — we got burned by exactly that with kimpanel and with WowType's
theme extension.

## CLI

Prefer not to click? Write the marker file and log out (the extension reads the same
file):

```bash
echo fcitx5 > ~/.config/im-switcher/framework   # or ibus
gnome-session-quit --logout --no-prompt
```

## Uninstall

```bash
./scripts/install.sh --uninstall
```

Removes the extension, drops it from the enabled list, and strips the
`~/.bash_profile` snippet. These are left for manual cleanup if you want them gone:

```bash
rm -rf ~/.config/im-switcher                            # framework marker
rm -f  ~/.config/environment.d/im-switcher.conf
rm -f  ~/.config/autostart/org.fcitx.Fcitx5.desktop     # suppressed fcitx5 autostart
```

## License

MIT
