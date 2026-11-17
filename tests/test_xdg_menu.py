import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HELPER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "xdg-menu.py")

ROOT_MENU = """
<!DOCTYPE Menu PUBLIC "-//freedesktop//DTD Menu 1.0//EN"
 "http://www.freedesktop.org/standards/menu-spec/1.0/menu.dtd">
<Menu>
  <Name>Applications</Name>
  <Directory>X-GNOME-Menu-Applications.directory</Directory>
  <DefaultAppDirs/>
  <DefaultDirectoryDirs/>
  <Menu>
    <Name>Accessories</Name>
    <Directory>Utility.directory</Directory>
    <Include><Category>Utility</Category></Include>
  </Menu>
  <Menu>
    <Name>Games</Name>
    <Directory>Game.directory</Directory>
    <Include><Category>Game</Category></Include>
  </Menu>
  <Menu>
    <Name>Education</Name>
    <Directory>Education.directory</Directory>
    <Include><Category>Education</Category></Include>
  </Menu>
  <Menu>
    <Name>Other</Name>
    <Directory>X-GNOME-Other.directory</Directory>
    <OnlyUnallocated/>
    <Include><All/></Include>
  </Menu>
  <DefaultMergeDirs/>
</Menu>
"""

# Like waydroid.menu: a custom category merged in by a third-party package.
CUSTOM_MENU = """
<Menu>
  <Name>Applications</Name>
  <Menu>
    <Name>Droid</Name>
    <Directory>droid.directory</Directory>
    <Include><Category>X-Droid-App</Category></Include>
  </Menu>
</Menu>
"""

# Like the menus Wine writes per program: Wine > Programs > <program>.
NESTED_MENU = """
<Menu>
  <Name>Applications</Name>
  <Menu>
    <Name>emu-emu</Name>
    <Directory>emu-emu.directory</Directory>
    <Menu>
      <Name>Programs</Name>
      <Menu>
        <Name>Notes</Name>
        <Include><Filename>emu-notes.desktop</Filename></Include>
      </Menu>
    </Menu>
  </Menu>
</Menu>
"""

APPS = {
    "calc": "Name=Calculator\nName[zh_CN]=计算器\nIcon=accessories-calculator\nCategories=Utility;\nKeywords=math;\n",
    "nodisplay": "Name=NoDisplay App\nCategories=Utility;\nNoDisplay=true\n",
    "hidden": "Name=Hidden App\nCategories=Utility;\nHidden=true\n",
    "only-kde": "Name=KDE Only\nCategories=Utility;\nOnlyShowIn=KDE;\n",
    "only-niri": "Name=Niri Only\nCategories=Utility;\nOnlyShowIn=KDE;niri;\n",
    "not-niri": "Name=Not Niri\nCategories=Utility;\nNotShowIn=niri;\n",
    "kde-not-niri": "Name=KDE Not Niri\nCategories=Utility;\nOnlyShowIn=KDE;\nNotShowIn=niri;\n",
    "no-tryexec": "Name=Missing Binary\nCategories=Utility;\nTryExec=/nonexistent/binary\n",
    "chess": "Name=Chess\nName[zh_CN]=国际象棋\nCategories=Game;\n",
    "droid.maps": "Name=Maps\nName[zh_CN]=地图\nIcon=/tmp/maps.png\nCategories=X-Droid-App;\n",
    "droid.clock": "Name=Clock\nCategories=X-Droid-App;\nNoDisplay=true\n",
    "loose": "Name=Loose\n",
    "emu-notes": "Name=Notes\nCategories=X-Emu;\n",
}

DIRECTORIES = {
    # Overrides the bundled fallback of the same name.
    "Game.directory": "Name=Fixture Games\nName[zh_CN]=夹具游戏\nIcon=fixture-games\n",
    "droid.directory": "Name=Droid\nName[zh_CN]=安卓\nIcon=droid\n",
    "emu-emu.directory": "Name=Emu\nIcon=emu\n",
}


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class XdgMenuTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = cls.tmp.name
        write(f"{root}/etc/menus/applications.menu", ROOT_MENU)
        write(f"{root}/etc/menus/applications-merged/droid.menu", CUSTOM_MENU)
        write(f"{root}/home/config/menus/applications-merged/emu.menu", NESTED_MENU)
        for name, body in APPS.items():
            write(f"{root}/usr/applications/{name}.desktop", f"[Desktop Entry]\nType=Application\nExec=true\n{body}")
        for name, body in DIRECTORIES.items():
            write(f"{root}/usr/desktop-directories/{name}", f"[Desktop Entry]\nType=Directory\n{body}")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_helper(self, lang="zh_CN.UTF-8", desktop="niri"):
        root = self.tmp.name
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": f"{root}/home",
            "XDG_CONFIG_HOME": f"{root}/home/config",
            "XDG_DATA_HOME": f"{root}/home/data",
            "XDG_CONFIG_DIRS": f"{root}/etc",
            "XDG_DATA_DIRS": f"{root}/usr",
            "XDG_CURRENT_DESKTOP": desktop,
            "LANG": lang,
        }
        out = subprocess.run([sys.executable, HELPER], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    @staticmethod
    def folder(node, *names):
        for name in names:
            node = next(m for m in node["menus"] if m["id"].split("/")[-1] == name)
        return node

    @staticmethod
    def app_ids(node):
        return [a["id"] for a in node["apps"]]

    @staticmethod
    def app(node, app_id):
        return next(a for a in node["apps"] if a["id"] == app_id)

    def test_custom_merged_menu_is_its_own_folder(self):
        menu = self.run_helper()
        droid = self.folder(menu, "Droid")
        self.assertEqual(droid["name"], "安卓")
        self.assertEqual(droid["icon"], "droid")
        self.assertEqual(self.app_ids(droid), ["droid.maps"])
        self.assertEqual(droid["apps"][0]["icon"], "/tmp/maps.png")
        self.assertNotIn("droid.maps", self.app_ids(self.folder(menu, "Other")))

    def test_nested_folders(self):
        menu = self.run_helper()
        emu = self.folder(menu, "emu-emu")
        self.assertEqual(emu["name"], "Emu")
        self.assertEqual(emu["apps"], [])
        notes = self.folder(emu, "Programs", "Notes")
        self.assertEqual(notes["id"], "emu-emu/Programs/Notes")
        self.assertEqual(self.app_ids(notes), ["emu-notes"])

    def test_visibility_rules(self):
        accessories = self.folder(self.run_helper(), "Accessories")
        self.assertEqual(sorted(self.app_ids(accessories)), ["calc", "only-niri"])

    def test_desktop_list_first_match_wins(self):
        accessories = self.folder(self.run_helper(desktop="KDE:niri"), "Accessories")
        self.assertEqual(sorted(self.app_ids(accessories)), ["calc", "kde-not-niri", "only-kde", "only-niri"])
        accessories = self.folder(self.run_helper(desktop="niri:KDE"), "Accessories")
        self.assertEqual(sorted(self.app_ids(accessories)), ["calc", "only-kde", "only-niri"])

    def test_empty_folders_dropped(self):
        ids = [m["id"] for m in self.run_helper()["menus"]]
        self.assertNotIn("Education", ids)
        self.assertEqual(sorted(ids), ["Accessories", "Droid", "Games", "Other", "emu-emu"])

    def test_chinese_names(self):
        menu = self.run_helper()
        accessories = self.folder(menu, "Accessories")
        self.assertEqual(accessories["name"], "附件")  # bundled fallback .directory
        self.assertEqual(accessories["icon"], "applications-accessories")
        self.assertEqual(self.app(accessories, "calc")["name"], "计算器")
        self.assertEqual(self.folder(menu, "Games")["name"], "夹具游戏")  # system file wins
        self.assertEqual(self.folder(menu, "Games")["apps"][0]["name"], "国际象棋")

    def test_english_names(self):
        menu = self.run_helper(lang="C")
        accessories = self.folder(menu, "Accessories")
        self.assertEqual(accessories["name"], "Accessories")
        self.assertEqual(self.app(accessories, "calc")["name"], "Calculator")
        self.assertEqual(self.app(accessories, "calc")["keywords"], ["math"])

    def test_unallocated_go_to_other(self):
        self.assertEqual(self.app_ids(self.folder(self.run_helper(), "Other")), ["loose"])


if __name__ == "__main__":
    unittest.main()
