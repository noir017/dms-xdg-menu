import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// menu.js is a QML JavaScript library; drop the QML pragma and load it as a plain script.
const source = readFileSync(new URL("../menu.js", import.meta.url), "utf8").replace(/^\.pragma library$/m, "");
const XdgMenu = new Function(`${source}\nreturn { build, parseXml, parseEntry, languages, localized };`)();
const BUNDLED = fileURLToPath(new URL("../data", import.meta.url)).replace(/\/$/, "");

const ROOT_MENU = `<?xml version="1.0"?>
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
`;

// Like waydroid.menu: a custom category merged in by a third-party package.
const CUSTOM_MENU = `
<Menu>
  <Name>Applications</Name>
  <Menu>
    <Name>Droid</Name>
    <Directory>droid.directory</Directory>
    <Include><Category>X-Droid-App</Category></Include>
  </Menu>
</Menu>
`;

// Like the menus Wine writes per program: Wine > Programs > <program>.
const NESTED_MENU = `
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
`;

const APPS = {
    "calc": "Name=Calculator\nName[zh_CN]=计算器\nIcon=accessories-calculator\nCategories=Utility;\nKeywords=math;\n",
    "nodisplay": "Name=NoDisplay App\nCategories=Utility;\nNoDisplay=true\n",
    "hidden": "Name=Hidden App\nCategories=Utility;\nHidden=true\n",
    "only-kde": "Name=KDE Only\nCategories=Utility;\nOnlyShowIn=KDE;\n",
    "only-niri": "Name=Niri Only\nCategories=Utility;\nOnlyShowIn=KDE;niri;\n",
    "not-niri": "Name=Not Niri\nCategories=Utility;\nNotShowIn=niri;\n",
    "kde-not-niri": "Name=KDE Not Niri\nCategories=Utility;\nOnlyShowIn=KDE;\nNotShowIn=niri;\n",
    "no-tryexec": "Name=Missing Binary\nCategories=Utility;\nTryExec=/nonexistent/binary\n",
    "has-tryexec": "Name=Present Binary\nCategories=Utility;\nTryExec=true\n",
    "chess": "Name=Chess\nName[zh_CN]=国际象棋\nCategories=Game;\n",
    "droid.maps": "Name=Maps\nName[zh_CN]=地图\nIcon=/tmp/maps.png\nCategories=X-Droid-App;\n",
    "droid.clock": "Name=Clock\nCategories=X-Droid-App;\nNoDisplay=true\n",
    "loose": "Name=Loose\n",
    "emu-notes": "Name=Notes\nCategories=X-Emu;\n",
};

const DIRECTORIES = {
    // Overrides the bundled fallback of the same name.
    "Game.directory": "Name=Fixture Games\nName[zh_CN]=夹具游戏\nIcon=fixture-games\n",
    "droid.directory": "Name=Droid\nName[zh_CN]=安卓\nIcon=droid\n",
    "emu-emu.directory": "Name=Emu\nIcon=emu\n",
};

const app = body => `[Desktop Entry]\nType=Application\nExec=true\n${body}`;
const directory = body => `[Desktop Entry]\nType=Directory\n${body}`;

function fixture(extra = {}) {
    const files = {
        "/fx/etc/menus/applications.menu": ROOT_MENU,
        "/fx/etc/menus/applications-merged/droid.menu": CUSTOM_MENU,
        "/fx/home/config/menus/applications-merged/emu.menu": NESTED_MENU,
    };
    for (const [name, body] of Object.entries(APPS))
        files[`/fx/usr/applications/${name}.desktop`] = app(body);
    for (const [name, body] of Object.entries(DIRECTORIES))
        files[`/fx/usr/desktop-directories/${name}`] = directory(body);
    for (const [path, text] of Object.entries(extra)) {
        if (text === null)
            delete files[path];
        else
            files[path] = text;
    }
    return files;
}

// Files live in memory; the bundled .directory files are read from the repository.
function memoryFs(files, loading = []) {
    return {
        read(path) {
            if (path in files)
                return files[path];
            if (path.startsWith(BUNDLED + "/")) {
                try {
                    return readFileSync(path, "utf8");
                } catch {
                    return null;
                }
            }
            return null;
        },
        list(dir) {
            if (loading.includes(dir))
                return undefined;
            const entries = new Map();
            for (const path of Object.keys(files)) {
                if (!path.startsWith(dir + "/"))
                    continue;
                const rest = path.slice(dir.length + 1);
                const slash = rest.indexOf("/");
                entries.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
            }
            return entries.size ? [...entries].map(([name, isDir]) => ({ name, dir: isDir })) : null;
        },
    };
}

// The list DMS keeps in memory (Quickshell's DesktopEntries): ids from paths, higher-priority dirs win,
// Hidden masks an id, NoDisplay entries are left out.
function dmsApps(files, env) {
    const langs = XdgMenu.languages(env);
    const list = value => (value || "").split(";").filter(item => item);
    const dataDirs = [env.XDG_DATA_HOME, ...env.XDG_DATA_DIRS.split(":")];
    const byId = new Map();
    for (const dir of dataDirs.reverse()) {
        const root = `${dir}/applications/`;
        for (const [path, text] of Object.entries(files)) {
            if (!path.startsWith(root) || !path.endsWith(".desktop"))
                continue;
            const id = path.slice(root.length, -8).replaceAll("/", "-");
            const entry = XdgMenu.parseEntry(text);
            byId.delete(id);
            if (!entry || entry.Hidden === "true" || entry.Type !== "Application" || !entry.Name)
                continue;
            byId.set(id, {
                id,
                name: XdgMenu.localized(entry, "Name", langs),
                genericName: XdgMenu.localized(entry, "GenericName", langs),
                comment: XdgMenu.localized(entry, "Comment", langs),
                icon: XdgMenu.localized(entry, "Icon", langs),
                keywords: list(XdgMenu.localized(entry, "Keywords", langs)),
                categories: list(entry.Categories),
                noDisplay: entry.NoDisplay === "true",
            });
        }
    }
    return [...byId.values()].filter(entry => !entry.noDisplay);
}

function build({ files = fixture(), lang = "zh_CN.UTF-8", desktop = "niri", env = {}, loading, compare, builtIn = [], extraDesktops } = {}) {
    const fullEnv = {
        HOME: "/fx/home",
        XDG_CONFIG_HOME: "/fx/home/config",
        XDG_DATA_HOME: "/fx/home/data",
        XDG_CONFIG_DIRS: "/fx/etc",
        XDG_DATA_DIRS: "/fx/usr",
        XDG_CURRENT_DESKTOP: desktop,
        LANG: lang,
        ...env,
    };
    return XdgMenu.build({
        env: fullEnv,
        apps: dmsApps(files, fullEnv).concat(builtIn.map(entry => ({ builtIn: true, ...entry }))),
        extraDesktops,
        fallbackDataDirs: [BUNDLED],
        ...memoryFs(files, loading),
        executable: name => name === "true",
        compare,
    });
}

function menu(options) {
    const result = build(options);
    assert.equal(result.error, "");
    assert.deepEqual(result.warnings, []);
    assert.equal(result.pending, false);
    return result.menu;
}

function folder(node, ...names) {
    for (const name of names) {
        const next = node.menus.find(m => m.id.split("/").pop() === name);
        assert.ok(next, `no folder ${name} in ${node.id || "the root"}: ${node.menus.map(m => m.id)}`);
        node = next;
    }
    return node;
}

const appIds = node => node.apps.map(a => a.id);
const folderIds = node => node.menus.map(m => m.id);
const findApp = (node, id) => node.apps.find(a => a.id === id);

// ---------- Folders, names and visibility

test("a custom merged menu is its own folder", () => {
    const root = menu();
    const droid = folder(root, "Droid");
    assert.equal(droid.name, "安卓");
    assert.equal(droid.icon, "droid");
    assert.deepEqual(appIds(droid), ["droid.maps"]);
    assert.equal(droid.apps[0].icon, "/tmp/maps.png");
    assert.ok(!appIds(folder(root, "Other")).includes("droid.maps"));
});

test("nested menus become nested folders", () => {
    const emu = folder(menu(), "emu-emu");
    assert.equal(emu.name, "Emu");
    assert.deepEqual(emu.apps, []);
    const notes = folder(emu, "Programs", "Notes");
    assert.equal(notes.id, "emu-emu/Programs/Notes");
    assert.deepEqual(appIds(notes), ["emu-notes"]);
});

test("NoDisplay, Hidden, OnlyShowIn, NotShowIn and TryExec", () => {
    const accessories = folder(menu(), "Accessories");
    assert.deepEqual(appIds(accessories).sort(), ["calc", "has-tryexec", "only-niri"]);
});

test("the first desktop in XDG_CURRENT_DESKTOP that an entry names decides", () => {
    let accessories = folder(menu({ desktop: "KDE:niri" }), "Accessories");
    assert.deepEqual(appIds(accessories).sort(), ["calc", "has-tryexec", "kde-not-niri", "only-kde", "only-niri"]);
    accessories = folder(menu({ desktop: "niri:KDE" }), "Accessories");
    assert.deepEqual(appIds(accessories).sort(), ["calc", "has-tryexec", "only-kde", "only-niri"]);
});

test("empty folders are dropped", () => {
    const ids = folderIds(menu());
    assert.ok(!ids.includes("Education"));
    assert.deepEqual(ids.sort(), ["Accessories", "Droid", "Games", "Other", "emu-emu"]);
});

test("Chinese names, with the bundled .directory files as the last resort", () => {
    const root = menu();
    assert.equal(root.name, "应用程序");
    const accessories = folder(root, "Accessories");
    assert.equal(accessories.name, "附件");
    assert.equal(accessories.icon, "applications-accessories");
    assert.equal(findApp(accessories, "calc").name, "计算器");
    assert.equal(folder(root, "Games").name, "夹具游戏");
    assert.equal(folder(root, "Games").icon, "fixture-games");
    assert.equal(folder(root, "Games").apps[0].name, "国际象棋");
});

test("English names", () => {
    const accessories = folder(menu({ lang: "C" }), "Accessories");
    assert.equal(accessories.name, "Accessories");
    assert.equal(findApp(accessories, "calc").name, "Calculator");
    assert.deepEqual(findApp(accessories, "calc").keywords, ["math"]);
});

test("unallocated entries go to Other", () => {
    assert.deepEqual(appIds(folder(menu(), "Other")), ["loose"]);
});

test("extra desktops show their OnlyShowIn apps without hiding NotShowIn ones", () => {
    const files = fixture({ "/fx/usr/applications/not-kde.desktop": app("Name=Not KDE\nCategories=Utility;\nNotShowIn=KDE;\n") });
    const accessories = folder(menu({ files, extraDesktops: ["KDE"] }), "Accessories");
    assert.deepEqual(appIds(accessories).sort(), ["calc", "has-tryexec", "not-kde", "only-kde", "only-niri"]);
});

// Like redhat-menus: settings are kept out of applications.menu and live in settings.menu.
const SETTINGS_MENU = `<Menu><Name>Settings</Name><Directory>Desktop.directory</Directory><DefaultAppDirs/><DefaultDirectoryDirs/><DefaultMergeDirs/>
  <Menu><Name>Preferences</Name><MergeFile>preferences.menu</MergeFile></Menu>
  <Menu><Name>Administration</Name><Include><And><Category>Settings</Category><Category>System</Category></And></Include></Menu>
</Menu>`;
const PREFERENCES_MENU = "<Menu><Name>Preferences</Name><Include><And><Category>Settings</Category><Not><Category>System</Category></Not></And></Include></Menu>";
const settingsFiles = (extra = {}) => fixture({
    "/fx/etc/menus/settings.menu": SETTINGS_MENU,
    "/fx/etc/menus/preferences.menu": PREFERENCES_MENU,
    "/fx/usr/applications/input.desktop": app("Name=Input Method\nCategories=Settings;\n"),
    "/fx/usr/applications/firewall.desktop": app("Name=Firewall\nCategories=System;Settings;\n"),
    "/fx/usr/desktop-directories/Desktop.directory": directory("Name=System\nName[zh_CN]=系统\nIcon=preferences-desktop\n"),
    ...extra,
});

test("settings.menu is one more folder, with its merged files", () => {
    const root = menu({ files: settingsFiles() });
    const settings = folder(root, "Settings");
    assert.equal(settings.name, "系统");
    assert.deepEqual(appIds(folder(settings, "Preferences")), ["input"]);
    assert.deepEqual(appIds(folder(settings, "Administration")), ["firewall"]);
    // Placed in settings, so not in Other; applications-merged is not merged a second time.
    assert.deepEqual(appIds(folder(root, "Other")), ["loose"]);
    assert.deepEqual(appIds(folder(root, "Droid")), ["droid.maps"]);
    assert.ok(!folderIds(settings).includes("Settings/Droid"));
});

test("without settings.menu, settings apps go to Other rather than nowhere", () => {
    const root = menu({ files: settingsFiles({ "/fx/etc/menus/settings.menu": null }) });
    assert.ok(!folderIds(root).includes("Settings"));
    assert.deepEqual(appIds(folder(root, "Other")).sort(), ["firewall", "input", "loose"]);
});

test("an app in no folder goes to Other, made when the menu has none; an Exclude keeps it out", () => {
    const files = fixture({
        "/fx/etc/menus/applications.menu": ROOT_MENU.replace(/<Menu>\s*<Name>Other<\/Name>[\s\S]*?<\/Menu>/, ""),
        "/fx/home/config/menus/applications-merged/user.menu": "<Menu><Name>Applications</Name><Menu><Name>Games</Name><Exclude><Filename>chess.desktop</Filename></Exclude></Menu></Menu>",
    });
    const other = folder(menu({ files }), "Other");
    assert.equal(other.name, "其他");
    assert.deepEqual(appIds(other), ["loose"]);
});

test("built-in apps have no desktop file and are placed by their categories", () => {
    const root = menu({ builtIn: [{ id: "dms:notes", name: "Notes", icon: "svg+corner:/logo.svg|description", categories: ["Office", "Utility"] }] });
    const notes = findApp(folder(root, "Accessories"), "dms:notes");
    assert.equal(notes.icon, "svg+corner:/logo.svg|description");
    assert.ok(!appIds(folder(root, "Other")).includes("dms:notes"));
});

// ---------- Menu rules

const userMenu = body => ({ "/fx/home/config/menus/applications-merged/user.menu": `<Menu><Name>Applications</Name>${body}</Menu>` });

test("Move relocates a menu, creating the destination path", () => {
    const root = menu({ files: fixture(userMenu("<Move><Old>Accessories</Old><New>Tools/Utilities</New></Move>")) });
    assert.ok(!folderIds(root).includes("Accessories"));
    const utilities = folder(root, "Tools", "Utilities");
    assert.equal(utilities.id, "Tools/Utilities");
    assert.equal(utilities.name, "附件");
    assert.ok(appIds(utilities).includes("calc"));
});

test("Move into an existing menu merges, and the destination's rules come last", () => {
    const files = fixture(userMenu(`
        <Menu><Name>Fun</Name><Exclude><Filename>chess.desktop</Filename></Exclude><Include><Filename>calc.desktop</Filename></Include></Menu>
        <Move><Old>Games</Old><New>Fun</New></Move>`));
    const root = menu({ files });
    assert.ok(!folderIds(root).includes("Games"));
    const fun = folder(root, "Fun");
    assert.deepEqual(appIds(fun), ["calc"]);
    // Matched by an <Include>, so not unallocated either.
    assert.ok(!appIds(folder(root, "Other")).includes("chess"));
});

test("Deleted removes a menu before allocation; a later NotDeleted restores it", () => {
    let root = menu({ files: fixture(userMenu("<Menu><Name>Games</Name><Deleted/></Menu>")) });
    assert.ok(!folderIds(root).includes("Games"));
    assert.deepEqual(appIds(folder(root, "Other")).sort(), ["chess", "loose"]);
    root = menu({ files: fixture(userMenu("<Menu><Name>Games</Name><Deleted/></Menu><Menu><Name>Games</Name><NotDeleted/></Menu>")) });
    assert.deepEqual(appIds(folder(root, "Games")), ["chess"]);
});

test("OnlyUnallocated skips entries an Include matched, even if an Exclude removed them", () => {
    const root = menu({ files: fixture(userMenu("<Menu><Name>Games</Name><Exclude><Category>Game</Category></Exclude></Menu>")) });
    assert.ok(!folderIds(root).includes("Games"));
    assert.deepEqual(appIds(folder(root, "Other")), ["loose"]);
});

test("NotOnlyUnallocated overrides an earlier OnlyUnallocated", () => {
    const root = menu({ files: fixture(userMenu("<Menu><Name>Other</Name><NotOnlyUnallocated/></Menu>")) });
    assert.ok(appIds(folder(root, "Other")).includes("calc"));
});

test("several OnlyUnallocated menus each match the unallocated entries", () => {
    const root = menu({ files: fixture(userMenu("<Menu><Name>Leftovers</Name><OnlyUnallocated/><Include><Filename>loose.desktop</Filename></Include></Menu>")) });
    assert.deepEqual(appIds(folder(root, "Leftovers")), ["loose"]);
    assert.deepEqual(appIds(folder(root, "Other")), ["loose"]);
});

test("And, Or, Not, All, Category and Filename", () => {
    const root = menu({ files: fixture(userMenu(`
        <Menu><Name>Mixed</Name>
          <Include>
            <And><Category>Utility</Category><Not><Filename>calc.desktop</Filename><Category>Game</Category></Not></And>
            <Or><Filename>chess.desktop</Filename></Or>
            <And/>
          </Include>
          <Exclude><Not><All/></Not></Exclude>
          <Exclude><Filename>only-niri.desktop</Filename></Exclude>
        </Menu>`)) });
    assert.deepEqual(appIds(folder(root, "Mixed")).sort(), ["chess", "has-tryexec"]);
});

test("MergeDir merges every .menu file of a directory, relative to the menu file", () => {
    const root = menu({ files: fixture({
        "/fx/etc/menus/applications.menu": ROOT_MENU.replace("<DefaultMergeDirs/>", "<MergeDir>extra</MergeDir>"),
        "/fx/etc/menus/extra/b.menu": "<Menu><Name>x</Name><Menu><Name>Board</Name><Include><Filename>chess.desktop</Filename></Include></Menu></Menu>",
        "/fx/etc/menus/extra/a.menu": "<Menu><Name>x</Name><Menu><Name>Board</Name><Exclude><All/></Exclude></Menu></Menu>",
        "/fx/etc/menus/extra/notes.txt": "<Menu><Name>Ignored</Name></Menu>",
    }) });
    // Only the extra dir is merged, in name order, so b.menu's Include wins over a.menu's Exclude.
    assert.deepEqual(folderIds(root).sort(), ["Accessories", "Board", "Games", "Other"]);
    assert.equal(root.name, "应用程序");
    assert.deepEqual(appIds(folder(root, "Board")), ["chess"]);
});

test("menus with the same name are merged at every level", () => {
    const files = fixture({
        ...userMenu(`
            <Menu><Name>Tools</Name><Menu><Name>Net</Name><Include><Filename>calc.desktop</Filename></Include></Menu></Menu>
            <Menu><Name>Tools</Name><Directory>Utility.directory</Directory></Menu>`),
        "/fx/home/config/menus/applications-merged/zz.menu": `
            <Menu><Name>Applications</Name>
              <Menu><Name>Tools</Name><Menu><Name>Net</Name><Include><Filename>chess.desktop</Filename></Include></Menu></Menu>
              <Menu><Name>emu-emu</Name><Menu><Name>Programs</Name><Menu><Name>Notes</Name><Include><Filename>loose.desktop</Filename></Include></Menu></Menu></Menu>
            </Menu>`,
    });
    const root = menu({ files });
    assert.equal(folderIds(root).filter(id => id === "Tools").length, 1);
    const tools = folder(root, "Tools");
    assert.equal(tools.name, "附件");
    assert.deepEqual(folderIds(tools), ["Tools/Net"]);
    assert.deepEqual(appIds(folder(tools, "Net")).sort(), ["calc", "chess"]);
    assert.deepEqual(appIds(folder(root, "emu-emu", "Programs", "Notes")).sort(), ["emu-notes", "loose"]);
});

test("MergeFile type=parent merges the next menu file of the same name", () => {
    const files = fixture({
        "/fx/home/config/menus/applications.menu": `<Menu><Name>Applications</Name>
            <MergeFile type="parent">/fx/etc/menus/applications.menu</MergeFile>
            <Menu><Name>Games</Name><Deleted/></Menu></Menu>`,
    });
    const root = menu({ files });
    assert.ok(!folderIds(root).includes("Games"));
    assert.ok(folderIds(root).includes("Droid"));
});

test("XDG_MENU_PREFIX picks the prefixed menu, falling back to applications.menu", () => {
    const files = fixture({ "/fx/etc/menus/test-applications.menu": "<Menu><Name>Applications</Name><DefaultAppDirs/><Menu><Name>Only</Name><Include><All/></Include></Menu></Menu>" });
    assert.deepEqual(folderIds(menu({ files, env: { XDG_MENU_PREFIX: "test-" } })), ["Only"]);
    assert.ok(folderIds(menu({ env: { XDG_MENU_PREFIX: "missing-" } })).includes("Droid"));
});

test("AppDir limits a menu to its directories; desktop ids join subdirectories with -", () => {
    const files = fixture({
        "/fx/etc/menus/applications.menu": `<Menu><Name>Applications</Name><DefaultDirectoryDirs/>
            <Menu><Name>Local</Name><AppDir>../../home/data/applications</AppDir><Include><All/></Include></Menu>
            <Menu><Name>Vendor</Name><AppDir>/fx/usr/applications</AppDir><Include><Filename>vendor-tool.desktop</Filename></Include></Menu>
            </Menu>`,
        "/fx/home/data/applications/mine.desktop": app("Name=Mine\n"),
        "/fx/usr/applications/vendor/tool.desktop": app("Name=Tool\n"),
    });
    const root = menu({ files });
    assert.deepEqual(appIds(folder(root, "Local")), ["mine"]);
    assert.deepEqual(appIds(folder(root, "Vendor")), ["vendor-tool"]);
});

test("a .directory with NoDisplay hides its folder", () => {
    const root = menu({ files: fixture({ "/fx/usr/desktop-directories/Game.directory": directory("Name=Games\nNoDisplay=true\n") }) });
    assert.ok(!folderIds(root).includes("Games"));
});

test("root menu entries are kept on the root", () => {
    const files = fixture({ "/fx/etc/menus/applications.menu": ROOT_MENU.replace("<DefaultAppDirs/>", "<DefaultAppDirs/><Include><Filename>chess.desktop</Filename></Include>") });
    assert.deepEqual(appIds(menu({ files })), ["chess"]);
});

test("names sort like glibc: spaces and punctuation only break ties", () => {
    const names = ["K Voice", "KDE Connect", "KDebug", "K3b", "Wine Wordpad", "Winetricks"];
    const files = fixture(Object.fromEntries(names.map((name, i) => [`/fx/usr/applications/sort${i}.desktop`, app(`Name=${name}\nCategories=Game;\n`)])));
    const games = folder(menu({ files, lang: "C", compare: new Intl.Collator("en").compare }), "Games");
    assert.deepEqual(games.apps.map(a => a.name), ["Chess", "K3b", "KDebug", "KDE Connect", "K Voice", "Winetricks", "Wine Wordpad"]);
});

// ---------- Files, listings and errors

test("reports the files and directories to watch", () => {
    const result = build();
    for (const path of ["/fx/home/config/menus/applications.menu", "/fx/etc/menus/applications.menu", "/fx/etc/menus/applications-merged/droid.menu", "/fx/usr/desktop-directories/droid.directory", `${BUNDLED}/desktop-directories/Utility.directory`])
        assert.ok(result.files.includes(path), path);
    for (const dir of ["/fx/etc/menus/applications-merged", "/fx/home/config/menus/applications-merged", "/fx/usr/applications"])
        assert.ok(result.dirs.includes(dir), dir);
    assert.ok(!result.files.some(path => path.endsWith(".desktop")));
});

test("a listing still loading leaves the menu pending", () => {
    for (const dir of ["/fx/etc/menus/applications-merged", "/fx/usr/applications"]) {
        const result = build({ loading: [dir] });
        assert.equal(result.pending, true);
        assert.equal(result.menu, null);
        assert.ok(result.dirs.includes(dir));
    }
});

test("a broken merged file is skipped with a warning", () => {
    const result = build({ files: fixture({ "/fx/etc/menus/applications-merged/broken.menu": "<Menu><Name>x</Name>" }) });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /broken\.menu/);
    assert.ok(folderIds(result.menu).includes("Droid"));
});

test("no menu file is an error", () => {
    const result = build({ files: fixture({ "/fx/etc/menus/applications.menu": null }) });
    assert.equal(result.menu, null);
    assert.match(result.error, /no applications\.menu/);
});

test("the XML parser handles entities, comments, CDATA and a DOCTYPE with a subset", () => {
    const root = XdgMenu.parseXml(`<?xml version="1.0"?>
        <!DOCTYPE Menu [ <!ENTITY x "]>"> ]>
        <!-- a comment with <Menu> -->
        <Menu kind='a &amp; b'><Name>A &lt;&gt; &quot;&apos; &#38;&#x26;</Name><Empty/><![CDATA[<raw>&amp;]]></Menu>`);
    assert.equal(root.name, "Menu");
    assert.equal(root.attrs.kind, "a & b");
    assert.deepEqual(root.children[0].children, ["A <> \"' &&"]);
    assert.deepEqual(root.children[1], { name: "Empty", attrs: {}, children: [] });
    assert.equal(root.children[2], "<raw>&amp;");
    for (const bad of ["<Menu>", "<Menu></Name>", "<Menu>&nope;</Menu>", "text<Menu/>", "<Menu/><Menu/>", "<Menu><!-- x</Menu>"])
        assert.throws(() => XdgMenu.parseXml(bad), bad);
});
