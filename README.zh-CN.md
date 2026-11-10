# im-switcher

顶栏一键切换 GNOME 的输入法框架：**IBus ⇄ Fcitx5**。

点一下顶栏的键盘图标 → 「切换到 Fcitx5」→ 配置立刻写入 → 弹窗问你要
「立即重启 / 立即注销 / 稍后」。选稍后的话，菜单里会留着「立即注销 / 立即重启」随时补刀，
顶栏也会显示 `重登后生效：Fcitx5`，不会骗你。

**[English](README.md)** · [GNOME Extensions](https://extensions.gnome.org/extension/0000/im-switcher/)

## 为什么需要它

Fedora / Ubuntu 默认用 IBus，而 Fcitx5 才有微信输入法那类的体验（比如
[WowType](https://github.com/Gloridust/WowType)、雾凇拼音）。两个框架可以同时装，
但同一个会话只能有一个生效，官方切换方式永远是「改环境变量 → 注销重登」——
忘了改哪儿、改完忘了注销，都很烦。这个扩展把这件事变成一个点击。

## 安装

```bash
git clone https://github.com/handsomezhuzhu/im-switcher.git
cd im-switcher
./scripts/install.sh          # 卸载：./scripts/install.sh --uninstall
```

不需要 root，全部装在 `$HOME` 下面。装完**注销重登**一次（GNOME Shell 不会热重载扩展代码）。

依赖：`gjs`、`gettext`（编译翻译用）。

```bash
sudo dnf install gjs gettext      # Fedora
sudo apt install gjs gettext      # Ubuntu / Debian
```

## 它是怎么让切换生效的

这是本扩展唯一有技术含量的地方，踩过两个坑：

**坑 1：光写 `~/.config/environment.d/` 不够。**
gnome-session 在 Wayland 下会**以登录 shell 重新 exec 自己**
（`gnome-session/gnome-session/leader-main.c` 的 `maybe_reexec_with_login_shell`），
于是 `/etc/profile.d/fcitx5.sh`（fcitx5 的 RPM 自带）被 sourcing 进会话环境，
把 `GTK_IM_MODULE` 等四个变量**无条件设回 fcitx**，覆盖掉 environment.d 的结果。

**坑 2：光有环境变量也不够。**
切到 IBus 时如果 fcitx5 还在自启动，两个框架的后台程序会同时跑、互相抢快捷键。
所以扩展还会用 `~/.config/autostart/org.fcitx.Fcitx5.desktop` + `Hidden=true`
把 fcitx5 的自启动盖掉，切回来时再删掉这个覆盖。

所以配置写两处，缺一不可：

| 文件 | 谁读它 |
|---|---|
| `~/.config/environment.d/im-switcher.conf` | systemd 用户管理器 |
| `~/.config/im-switcher/framework` | `~/.bash_profile` 里的片段（安装时追加，带标记，可干净撤掉） |

`~/.bash_profile` 那段在 `/etc/profile.d/fcitx5.sh` **之后**执行，所以它赢。

## 目录结构

```
extension.js          顶栏图标、菜单、弹窗（UI 全在这，英文源码 + gettext）
lib/profiles.js       框架状态读写：纯逻辑，只用 GLib/Gio，不依赖 GNOME Shell
lib/session.js        注销/重启：org.gnome.SessionManager，失败退回命令行
metadata.json         扩展元数据（UUID、支持的 Shell 版本、gettext 域）
data/                 ~/.bash_profile 片段
scripts/              install.sh · build-zip.sh · update-pot.sh · ci-shell-test.sh
tests/                gjs 单元测试，不需要 GNOME Shell
po/                   翻译模板和各语言
.github/workflows/    CI
```

把纯逻辑和 GNOME Shell 依赖分开，是为了让 `lib/` 能在 CI 里用 `gjs` 直接测。

## 测试

```bash
./tests/run.sh                        # 单元测试（只要 gjs）
./scripts/ci-shell-test.sh            # 无头 GNOME Shell 真加载一次
```

第二条是重点：它用一个临时 `$HOME` 装上扩展、起一条独立会话总线、
跑 `gnome-shell --headless --no-x11`（mutter 的无头后端，不开窗口、不碰显示器），
然后断言

- 日志里出现 `[im-switcher] enabled, framework=...`
- 没有任何 `im-switcher` 相关的 error / warning

开发中它抓到的真问题：

- `St.BoxLayout` 的 `vertical` 属性在 GNOME 48 被删（换成 `orientation`），
  语法检查完全看不出来，只有真加载才会炸
- `Gio.File.load_contents()` 返回的是 `[ok, bytes]`，不是单值
- `gsettings set` 在**没有会话总线**时写入会静默丢失（dconf 服务不在），
  所以启用那步必须挪进 `dbus-run-session` 里
- GVariant 的文本格式在 Ubuntu 的 GLib 上是 `@as []`、Fedora 上是 `[]`，
  解析不兼容会让安装脚本在 Debian 系上直接崩
- GNOME 46 用 `vertical`、48+ 用 `orientation`，写死任何一个都会炸掉一半支持范围

**在哪儿跑**：真机——自己的电脑、虚拟机、云盒子都行。需要 `gnome-shell`、`gjs`、
`gettext`、`dbus`，不需要 X 服务器、不需要 GPU、不需要显示器：

```bash
# instabox 盒子上（Ubuntu 24.04 / GNOME 46）
instabox ssh mybox -- 'sudo apt install -y gnome-shell gjs gettext'
instabox ssh mybox -- 'git clone https://github.com/handsomezhuzhu/im-switcher.git \
  && cd im-switcher && SHELL_TIMEOUT=60 bash scripts/ci-shell-test.sh'
```

已在 Fedora 45 / GNOME 51.1 和 Ubuntu 24.04 / GNOME 46 上验证。

**为什么它不是 GitHub Actions 的 job**：它需要真的把 mutter compositor 跑起来。
GitHub 的容器没有 GPU、没有 seat、也没有 logind，`gnome-shell --headless` 建完软件
渲染器就静默退出（退出码 0，连错误都不打）——这是环境限制，不是代码问题。
CI 里只放静态检查；单元测试和真加载测试都在本地或真机上跑。

## 翻译

源码字符串一律英文，用 `_()` 包起来；`po/zh_CN.po` 提供中文。
装的时候 `msgfmt` 把 `.po` 编成 `.mo` 放到扩展目录的 `locale/` 下，
GNOME Shell 的 `initTranslations()` 会自动找到。

```bash
./scripts/update-pot.sh     # 加了新 _("...") 之后跑，重新生成 .pot 并合并
```

## 发布到 GNOME Extensions

1. 在 GitHub 建仓库并推送（`metadata.json` 里的 `url` 要指向它）
2. `./scripts/build-zip.sh` 打出 `im-switcher.zip`
3. 打开 <https://extensions.gnome.org/upload/>，用 GitHub 账号登录，上传
4. 审核通过后会拿到一个扩展页；以后发新版就是重新打包上传

zip 的根目录直接是扩展文件（`metadata.json` 在根上），和 EGO 上其它扩展一致。
上传前确认 `metadata.json` 的 `shell-version` 覆盖了当前 GNOME——
EGO 靠它决定扩展能不能加载，代码没问题但版本声明没跟上，是最常见的"装了不生效"。

## 命令行

不想点鼠标的话，直接写标记文件再注销就行（扩展和它读的是同一个文件）：

```bash
echo fcitx5 > ~/.config/im-switcher/framework   # 或 ibus
gnome-session-quit --logout --no-prompt
```

## 卸载

```bash
./scripts/install.sh --uninstall
```

会删掉扩展、从启用列表移除、撤掉 `~/.bash_profile` 里的片段。
这几项留着按需手动清理：

```bash
rm -rf ~/.config/im-switcher                            # 框架标记
rm -f  ~/.config/environment.d/im-switcher.conf
rm -f  ~/.config/autostart/org.fcitx.Fcitx5.desktop     # 被 Hidden 盖住的 fcitx5 自启动
```

## 许可

MIT
