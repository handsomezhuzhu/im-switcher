# im-switcher

顶栏一键切换 GNOME 的输入法框架：**IBus ⇄ Fcitx5**。

点键盘图标 →「切换到 Fcitx5」→ 配置立刻写入 → 弹窗问立即重启/注销还是稍后。
在你操作之前，顶栏一直显示 `重登后生效：Fcitx5`，不骗你。

**[English](README.md)**

## 安装

```bash
git clone https://github.com/handsomezhuzhu/im-switcher.git
cd im-switcher
./scripts/install.sh          # 卸载：./scripts/install.sh --uninstall
```

装完注销重登一次（GNOME Shell 不热重载扩展代码）。依赖 `gjs` 和 `gettext`，不需要 root。

## 原理

gnome-session 在 Wayland 下会以登录 shell 重新 exec 自己，而
`/etc/profile.d/fcitx5.sh`（fcitx5 的 RPM 自带）会把 `GTK_IM_MODULE` 无条件设成
fcitx，覆盖掉 `~/.config/environment.d`。所以配置写两处：

| 文件 | 谁读它 |
|---|---|
| `~/.config/environment.d/im-switcher.conf` | systemd 用户管理器 |
| `~/.config/im-switcher/framework` | `~/.bash_profile` 里的片段（安装时追加） |

切到 IBus 时还会给 fcitx5 的自启动盖一个 `Hidden=true`，免得两个后台互相抢快捷键。

## 测试

```bash
./tests/run.sh                  # 单元测试，只要 gjs，约 2 秒
./scripts/ci-shell-test.sh      # 无头 GNOME Shell 真加载一次
```

第二条需要真的 compositor，在真机上跑（GitHub 容器养不起）：

```bash
instabox ssh mybox -- 'sudo apt install -y gnome-shell gjs gettext'
instabox ssh mybox -- 'git clone https://github.com/handsomezhuzhu/im-switcher.git \
  && cd im-switcher && SHELL_TIMEOUT=60 bash scripts/ci-shell-test.sh'
```

已在 Fedora 45 / GNOME 51 和 Ubuntu 24.04 / GNOME 46 上验证。

## 翻译

源码字符串英文、用 `_()` 包起来，中文在 `po/zh_CN.po`。加了新字符串跑
`./scripts/update-pot.sh`。

## 发布

```bash
./scripts/build-zip.sh          # 生成 im-switcher.zip
```

传到 <https://extensions.gnome.org/upload/>。注意 `metadata.json` 里的
`shell-version` 要覆盖当前 GNOME——声明跟不上是 EGO 上"装了不生效"的头号原因。

注意：EGO 的静态检查器 `shexli` 会对这里的 `shell-version` 报 `EGO-M-004`，
因为它把"主版本号 > 50"硬编码成未来版本。GNOME 51 早就发布了、EGO 也接受，
别为了消掉这个提示把 51 删了。

## 命令行

```bash
echo fcitx5 > ~/.config/im-switcher/framework   # 或 ibus
gnome-session-quit --logout --no-prompt
```

## 许可

MIT
