# XDG App Menu for DMS

A [DMS](https://github.com/duxlabs-dev/dux-shell) bar widget that opens a categorized start menu, like the KDE or XFCE application menu: Favorites and folders on the left, applications on the right, search on top.

Folders come from the freedesktop [menu specification](https://specifications.freedesktop.org/menu-spec/latest/), not from a fixed category list. Programs that install their own `.menu` file (Waydroid, Wine, ...) get their own folder, nested menus become nested folders, and `NoDisplay`, `Hidden`, `OnlyShowIn`/`NotShowIn` and `TryExec` are honored. The menu is re-read every time the panel opens.

中文简介：DMS 顶栏插件「分类开始菜单」。按 XDG 菜单规范把应用分进文件夹（左侧常用和文件夹、右侧应用、顶部搜索），Waydroid、Wine 这类自带 `.menu` 的程序自成文件夹，支持嵌套；右键应用可加入常用，常用里拖动排序；界面沿用 DMS 应用抽屉的组件和动态主题，启动应用走 DMS 启动器同一套方法。

## Requirements

- DMS 2.1 or newer
- `python3` with [pyxdg](https://pypi.org/project/pyxdg/) (`python3-pyxdg` on Fedora, `python3-xdg` on Debian/Ubuntu, `python-pyxdg` on Arch). The pyxdg 0.28 release on PyPI does not work with Python 3.14 or newer; distribution packages that patch it (Fedora's does) are fine.

## Install

From the latest release:

```sh
curl -LO https://github.com/noir017/dms-xdg-menu/releases/latest/download/xdgMenu.zip
rm -rf ~/.config/dms/plugins/xdgMenu
unzip xdgMenu.zip -d ~/.config/dms/plugins/
dms ipc call plugins enable xdgMenu
```

From source:

```sh
git clone https://github.com/noir017/dms-xdg-menu.git && cd dms-xdg-menu
scripts/package.sh
rm -rf ~/.config/dms/plugins/xdgMenu
unzip dist/xdgMenu.zip -d ~/.config/dms/plugins/
dms ipc call plugins enable xdgMenu
```

Then add **XDG App Menu** to a bar in Settings. It can replace the built-in launcher button. To upgrade, repeat the same steps and restart DMS (`systemctl --user restart dms.service`).

## Favorites

Favorites sit at the top of the folder list, and the panel opens on them when there are any.

- Right-click an application in any folder or in the search results and choose **Add to Favorites** or **Remove from Favorites**.
- Drag a favorite up or down to reorder; the order is saved when you drop it.

Favorites are stored by desktop id in the plugin's settings (`~/.config/dms/plugin_settings.json`), so they survive restarts and upgrades. Applications that are no longer installed are not shown.

## Keyboard and IPC

| Key | Action |
| --- | --- |
| typing | search all applications |
| Enter | launch the selected application (the first match while searching) |
| Up / Down | change folder, or move through the applications |
| Right, Tab / Left | move between the folder and application columns |
| Esc | close |

```sh
dms ipc call xdgMenu toggle   # also: open, close
```

niri example:

```kdl
Mod+Space { spawn "dms" "ipc" "call" "xdgMenu" "toggle"; }
```

## How it works

`xdg-menu.py` parses `${XDG_MENU_PREFIX}applications.menu` with pyxdg and prints the visible tree as JSON; the widget runs it when the panel opens. Names and icons are localized from `.desktop` and `.directory` files. When the system lacks the `.directory` files for the standard categories (the menu file references them, but they ship in a separate package on some distributions), the bundled ones in `data/desktop-directories` are used. System files always win.

Applications are launched through the DMS launcher, so launch prefix, per-app overrides, "focus running app" and usage history behave the same as in the app drawer.

## Development

```sh
python3 -m unittest discover -s tests   # menu helper and manifest (needs pyxdg)
node --test tests/*.test.mjs            # favorites logic
```

Every push to `main` runs the tests. When the `version` in `plugin.json` has no tag yet, CI tags `v<version>` and publishes a release with `xdgMenu.zip`.

## License

MIT
