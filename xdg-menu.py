#!/usr/bin/env python3
"""Print the freedesktop application menu as JSON.

Output: a tree of folders {id, name, icon, menus: [...], apps: [...]}, rooted
at the top-level menu. Only entries visible on the current desktop are kept
and empty folders are dropped.
"""

import json
import locale
import os
import sys

# Bundled .directory files come last, so the system's own always win.
_data_dirs = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"
os.environ["XDG_DATA_DIRS"] = _data_dirs + ":" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

import xdg.Menu  # noqa: E402  (reads XDG_DATA_DIRS on import)


def shown_in(entry, desktops):
    """OnlyShowIn/NotShowIn check; the first matching desktop decides."""
    only, never = entry.getOnlyShowIn(), entry.getNotShowIn()
    for desktop in desktops:
        if desktop in only:
            return True
        if desktop in never:
            return False
    return not only


def app(entry):
    de = entry.DesktopEntry
    return {
        "id": entry.DesktopFileID.removesuffix(".desktop"),
        "name": de.getName(),
        "genericName": de.getGenericName(),
        "comment": de.getComment(),
        "icon": de.getIcon(),
        "keywords": de.getKeywords(),
    }


def folder(menu, desktops):
    node = {"id": menu.getPath(org=True), "name": menu.getName(), "icon": menu.getIcon(), "menus": [], "apps": []}
    for entry in menu.getEntries():
        if isinstance(entry, xdg.Menu.Menu):
            sub = folder(entry, desktops)
            if sub["menus"] or sub["apps"]:
                node["menus"].append(sub)
        elif isinstance(entry, xdg.Menu.MenuEntry) and shown_in(entry.DesktopEntry, desktops):
            node["apps"].append(app(entry))
    return node


def main():
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    desktops = [d for d in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":") if d]
    menu = xdg.Menu.parse(sys.argv[1] if len(sys.argv) > 1 else None)
    json.dump(folder(menu, desktops), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
