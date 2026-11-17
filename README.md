# XDG App Menu for DMS

A [DMS](https://github.com/duxlabs-dev/dux-shell) bar widget that opens a categorized start menu, like the KDE or XFCE application menu: folders on the left, applications on the right, search on top.

Folders come from the freedesktop [menu specification](https://specifications.freedesktop.org/menu-spec/latest/), not from a fixed category list. Programs that install their own `.menu` file (Waydroid, Wine, ...) get their own folder, nested menus become nested folders, and `NoDisplay`, `Hidden`, `OnlyShowIn`/`NotShowIn` and `TryExec` are honored. The menu is re-read every time the panel opens.

中文简介：DMS 顶栏插件「分类开始菜单」。按 XDG 菜单规范把应用分进文件夹（左侧文件夹、右侧应用、顶部搜索），Waydroid、Wine 这类自带 `.menu` 的程序自成文件夹，支持嵌套；界面沿用 DMS 应用抽屉的组件和动态主题，启动应用走 DMS 启动器同一套方法。

## Requirements

- DMS 2.1 or newer
- `python3` with [pyxdg](https://pypi.org/project/pyxdg/) (`python3-pyxdg` on Fedora, `python3-xdg` on Debian/Ubuntu, `python-pyxdg` on Arch)

## Install

```sh
git clone <this repo> dms-xdg-menu && cd dms-xdg-menu
rsync -a --exclude '.*' --exclude tests --exclude '*.md' ./ ~/.config/dms/plugins/xdgMenu/
dms ipc call plugins enable xdgMenu
```

Then add **XDG App Menu** to a bar in Settings. It can replace the built-in launcher button.

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

## Tests

```sh
python3 -m unittest discover -s tests
```

## License

MIT
