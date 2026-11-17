.pragma library

// Freedesktop application menu (https://specifications.freedesktop.org/menu-spec/latest/).
// Plain JavaScript shared by the widget and the node tests: all file access goes through callbacks.
//
// build(options) reads ${XDG_MENU_PREFIX}applications.menu and sorts DMS's applications into it.
//   env              environment variables: HOME, XDG_*, LANGUAGE, LC_ALL, LC_MESSAGES, LANG
//   apps             DMS's desktop entries: {id, name, genericName, comment, icon, keywords, categories}
//   fallbackDataDirs data dirs searched last for .directory files
//   read(path)       file text, or null when there is no such file
//   list(dir)        [{name, dir}], null when there is no such directory, undefined while still loading
//   executable(name) whether a TryExec program is installed
//   compare(a, b)    locale collation, used to sort names
// Returns {menu, pending, error, warnings, files, dirs}. menu is a folder tree {id, name, icon, menus,
// apps}, or null while a listing is pending or when there is no menu file. files and dirs are the menu
// files, .directory files and directories the result depends on, to watch for changes.

function build(options) {
    const ctx = context(options);
    const root = loadMenus(ctx);
    let menu = null;
    if (root) {
        handleMoves(root);
        removeDeleted(root);
        resolveMenu(root, [], []);
        const apps = indexApps(ctx, root);
        if (!ctx.pending) {
            allocate(root, apps);
            menu = output(ctx, root, "");
        }
    }
    return {
        menu: menu,
        pending: ctx.pending,
        error: ctx.error,
        warnings: ctx.warnings,
        files: Object.keys(ctx.files),
        dirs: Object.keys(ctx.dirs)
    };
}

function context(options) {
    const env = options.env || {};
    const home = env.HOME || "";
    // Unset, empty or relative values fall back to the defaults.
    const paths = (value, fallback) => {
        const dirs = (value || "").split(":").filter(dir => dir.charAt(0) === "/");
        return (dirs.length ? dirs : fallback.split(":")).map(normalize);
    };
    const ctx = {
        dataDirs: paths(env.XDG_DATA_HOME, home + "/.local/share").slice(0, 1).concat(paths(env.XDG_DATA_DIRS, "/usr/local/share:/usr/share")),
        configDirs: paths(env.XDG_CONFIG_HOME, home + "/.config").slice(0, 1).concat(paths(env.XDG_CONFIG_DIRS, "/etc/xdg")),
        fallbackDataDirs: (options.fallbackDataDirs || []).map(normalize),
        prefix: env.XDG_MENU_PREFIX || "",
        desktops: (env.XDG_CURRENT_DESKTOP || "").split(":").filter(name => name),
        langs: languages(env),
        apps: toArray(options.apps),
        executable: options.executable || (() => true),
        compare: options.compare || ((a, b) => a < b ? -1 : a > b ? 1 : 0),
        pending: false,
        error: "",
        warnings: [],
        files: {},
        dirs: {},
        merged: {}
    };
    ctx.read = path => {
        const text = options.read(path);
        return typeof text === "string" ? text : null;
    };
    ctx.list = dir => {
        ctx.dirs[dir] = true;
        const entries = options.list(dir);
        if (entries === undefined)
            ctx.pending = true;
        return entries || [];
    };
    return ctx;
}

// ---------- XML

const ENTITIES = {
    lt: "<",
    gt: ">",
    amp: "&",
    quot: "\"",
    apos: "'"
};
const TAG = /<([A-Za-z_:][-\w.:]*)((?:\s+[A-Za-z_:][-\w.:]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([A-Za-z_:][-\w.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Parses elements, text, comments, CDATA and the DOCTYPE; returns the root element {name, attrs, children}.
function parseXml(text) {
    const top = {
        name: "",
        attrs: {},
        children: []
    };
    const stack = [top];
    let i = 0;
    const fail = message => {
        throw new Error(message + " at offset " + i);
    };
    const skipPast = (token, from) => {
        const end = text.indexOf(token, from);
        if (end < 0)
            fail("unterminated markup");
        return end + token.length;
    };
    while (i < text.length) {
        const parent = stack[stack.length - 1];
        const lt = text.indexOf("<", i);
        if (lt !== i) {
            const chunk = text.slice(i, lt < 0 ? text.length : lt);
            if (stack.length > 1)
                parent.children.push(decodeEntities(chunk));
            else if (chunk.trim())
                fail("text outside the root element");
            if (lt < 0)
                break;
            i = lt;
        }
        if (text.startsWith("<!--", i)) {
            i = skipPast("-->", i + 4);
        } else if (text.startsWith("<![CDATA[", i)) {
            const end = skipPast("]]>", i + 9);
            parent.children.push(text.slice(i + 9, end - 3));
            i = end;
        } else if (text.startsWith("<?", i)) {
            i = skipPast("?>", i + 2);
        } else if (text.startsWith("<!DOCTYPE", i)) {
            i = skipDoctype(text, i, fail);
        } else if (text.startsWith("</", i)) {
            const end = skipPast(">", i + 2);
            const name = text.slice(i + 2, end - 1).trim();
            if (stack.length < 2 || parent.name !== name)
                fail("unexpected </" + name + ">");
            stack.pop();
            i = end;
        } else {
            TAG.lastIndex = i;
            const match = TAG.exec(text);
            if (!match || match.index !== i)
                fail("malformed tag");
            const element = {
                name: match[1],
                attrs: {},
                children: []
            };
            ATTRIBUTE.lastIndex = 0;
            let attribute;
            while ((attribute = ATTRIBUTE.exec(match[2])) !== null)
                element.attrs[attribute[1]] = decodeEntities(attribute[2] !== undefined ? attribute[2] : attribute[3]);
            parent.children.push(element);
            if (!match[3])
                stack.push(element);
            i = TAG.lastIndex;
        }
    }
    if (stack.length > 1)
        fail("unclosed <" + stack[stack.length - 1].name + ">");
    const roots = elements(top);
    if (roots.length !== 1)
        fail("expected one root element");
    return roots[0];
}

function skipDoctype(text, start, fail) {
    let depth = 0;
    let quote = "";
    for (let i = start + 9; i < text.length; i++) {
        const c = text.charAt(i);
        if (quote) {
            if (c === quote)
                quote = "";
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (c === "[") {
            depth++;
        } else if (c === "]") {
            depth--;
        } else if (c === ">" && depth === 0) {
            return i + 1;
        }
    }
    return fail("unterminated DOCTYPE");
}

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (all, name) => {
        if (name.charAt(0) === "#")
            return String.fromCodePoint(name.charAt(1) === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
        if (!ENTITIES.hasOwnProperty(name))
            throw new Error("unknown entity " + all);
        return ENTITIES[name];
    });
}

function elements(node) {
    return node.children.filter(child => typeof child !== "string");
}

function textOf(node) {
    return node.children.filter(child => typeof child === "string").join("").trim();
}

// ---------- Desktop entries

// The [Desktop Entry] group of a .desktop or .directory file, or null.
function parseEntry(text) {
    const groups = {};
    let group = null;
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.charAt(0) === "#")
            continue;
        if (line.charAt(0) === "[") {
            group = groups[line.replace(/^\[+|\]+$/g, "")] = {};
        } else if (group) {
            const eq = line.indexOf("=");
            if (eq > 0)
                group[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
    }
    return groups["Desktop Entry"] || groups["KDE Desktop Entry"] || null;
}

// Locale suffixes to try, best first, from LANGUAGE, LC_ALL, LC_MESSAGES or LANG.
function languages(env) {
    const value = env.LANGUAGE || env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
    const out = [];
    for (const locale of value.split(":")) {
        const match = /^([^_.@]+)(_[^.@]*)?(\.[^@]*)?(@.*)?$/.exec(locale);
        if (!match)
            continue;
        const lang = match[1];
        const territory = match[2] || "";
        const modifier = match[4] || "";
        for (const name of [lang + territory + modifier, lang + territory, lang + modifier, lang]) {
            if (out.indexOf(name) < 0)
                out.push(name);
        }
    }
    return out;
}

// Just the keys that decide whether an app is shown: a desktop file can hold hundreds of translations.
const SHOWN_KEYS = /^[ \t]*(?:\[([^\]\n]*)\]|(OnlyShowIn|NotShowIn|TryExec)[ \t]*=([^\n]*))/gm;

function parseShownKeys(text) {
    const keys = {};
    let group = null;
    let match;
    SHOWN_KEYS.lastIndex = 0;
    while ((match = SHOWN_KEYS.exec(text)) !== null) {
        if (match[1] !== undefined)
            group = match[1];
        else if (group === "Desktop Entry")
            keys[match[2]] = match[3].trim();
    }
    return group === null ? null : keys;
}

function localized(entry, key, langs) {
    for (const lang of langs) {
        const value = entry[key + "[" + lang + "]"];
        if (value !== undefined)
            return value;
    }
    return entry[key] || "";
}

function isTrue(value) {
    return value === "true" || value === "True" || value === "1";
}

function splitList(value) {
    const separator = value.indexOf(";") >= 0 ? ";" : value.indexOf("|") >= 0 ? "|" : ",";
    return value.split(separator).map(item => item.trim()).filter(item => item);
}

// OnlyShowIn/NotShowIn: the first desktop of XDG_CURRENT_DESKTOP that either list names decides.
function shownIn(entry, desktops) {
    const only = splitList(entry.OnlyShowIn || "");
    const not = splitList(entry.NotShowIn || "");
    for (const desktop of desktops) {
        if (only.indexOf(desktop) >= 0)
            return true;
        if (not.indexOf(desktop) >= 0)
            return false;
    }
    return only.length === 0;
}

// ---------- Loading and merging menu files

function newMenu(name) {
    return {
        name: name,
        appDirs: [],
        directoryDirs: [],
        directories: [],
        deleted: null,
        onlyUnallocated: null,
        rules: [],
        moves: [],
        submenus: [],
        parent: null,
        entries: []
    };
}

function loadMenus(ctx) {
    const names = [ctx.prefix + "applications.menu"];
    if (ctx.prefix)
        names.push("applications.menu");
    for (const name of names) {
        for (const dir of ctx.configDirs) {
            const path = dir + "/menus/" + name;
            ctx.files[path] = true;
            const text = ctx.read(path);
            if (text === null)
                continue;
            ctx.merged[path] = true;
            const menu = newMenu("");
            try {
                parseMenu(ctx, menuElement(text), path, menu, false);
            } catch (e) {
                ctx.error = path + ": " + e.message;
                return null;
            }
            return menu;
        }
    }
    ctx.error = "no " + names[0] + " in " + ctx.configDirs.map(dir => dir + "/menus").join(", ");
    return null;
}

function menuElement(text) {
    const root = parseXml(text);
    if (root.name !== "Menu")
        throw new Error("the root element is not <Menu>");
    return root;
}

// Applies the children of a <Menu> element to `menu`; merged files skip their root <Name>.
function parseMenu(ctx, node, file, menu, mergedRoot) {
    for (const child of elements(node)) {
        const text = textOf(child);
        switch (child.name) {
        case "Menu": {
            const submenu = newMenu("");
            parseMenu(ctx, child, file, submenu, false);
            addSubmenu(menu, submenu);
            break;
        }
        case "Name":
            if (text && !mergedRoot)
                menu.name = text;
            break;
        case "Directory":
            if (text)
                menu.directories.push(text);
            break;
        case "AppDir":
            if (text)
                menu.appDirs.push(resolvePath(file, text));
            break;
        case "DefaultAppDirs":
            for (const dir of ctx.dataDirs.slice().reverse())
                menu.appDirs.push(dir + "/applications");
            break;
        case "DirectoryDir":
            if (text)
                menu.directoryDirs.push(resolvePath(file, text));
            break;
        case "DefaultDirectoryDirs":
            for (const dir of ctx.dataDirs.concat(ctx.fallbackDataDirs).reverse())
                menu.directoryDirs.push(dir + "/desktop-directories");
            break;
        case "OnlyUnallocated":
        case "NotOnlyUnallocated":
            menu.onlyUnallocated = child.name === "OnlyUnallocated";
            break;
        case "Deleted":
        case "NotDeleted":
            menu.deleted = child.name === "Deleted";
            break;
        case "Include":
        case "Exclude":
            menu.rules.push({
                include: child.name === "Include",
                test: anyRule(child)
            });
            break;
        case "MergeFile":
            if (child.attrs.type === "parent")
                mergeParent(ctx, file, menu);
            else if (text)
                mergeFile(ctx, resolvePath(file, text), menu);
            break;
        case "MergeDir":
            if (text)
                mergeDir(ctx, resolvePath(file, text), menu);
            break;
        case "DefaultMergeDirs":
            for (const dir of ctx.configDirs.slice().reverse())
                mergeDir(ctx, dir + "/menus/applications-merged", menu);
            break;
        case "Move": {
            let from = null;
            for (const step of elements(child)) {
                if (step.name === "Old")
                    from = textOf(step);
                else if (step.name === "New" && from !== null)
                    menu.moves.push({
                        from: from,
                        to: textOf(step)
                    });
            }
            break;
        }
        }
    }
}

// Returns whether the file exists; a file is merged at most once.
function mergeFile(ctx, path, menu) {
    if (ctx.merged[path])
        return true;
    const text = ctx.read(path);
    if (text === null)
        return false;
    ctx.merged[path] = true;
    ctx.files[path] = true;
    let root;
    try {
        root = menuElement(text);
    } catch (e) {
        ctx.warnings.push("skipped " + path + ": " + e.message);
        return true;
    }
    parseMenu(ctx, root, path, menu, true);
    return true;
}

function mergeDir(ctx, dir, menu) {
    const names = ctx.list(dir).filter(entry => !entry.dir && entry.name.endsWith(".menu")).map(entry => entry.name);
    for (const name of names.sort())
        mergeFile(ctx, dir + "/" + name, menu);
}

// <MergeFile type="parent">: the same file in the next config dir after the one holding this file.
function mergeParent(ctx, file, menu) {
    const dirs = ctx.configDirs;
    for (let i = 0; i < dirs.length; i++) {
        if (!file.startsWith(dirs[i] + "/"))
            continue;
        const relative = file.slice(dirs[i].length);
        for (const dir of dirs.slice(i + 1)) {
            if (mergeFile(ctx, dir + relative, menu))
                return;
        }
        return;
    }
}

function addSubmenu(parent, menu) {
    for (const submenu of parent.submenus) {
        if (submenu.name === menu.name) {
            mergeMenu(submenu, menu, false);
            return submenu;
        }
    }
    menu.parent = parent;
    parent.submenus.push(menu);
    return menu;
}

// Adds the elements of `source` after those of `target`, or before them for <Move>; later ones win.
function mergeMenu(target, source, before) {
    const join = (a, b) => before ? b.concat(a) : a.concat(b);
    target.appDirs = join(target.appDirs, source.appDirs);
    target.directoryDirs = join(target.directoryDirs, source.directoryDirs);
    target.directories = join(target.directories, source.directories);
    target.rules = join(target.rules, source.rules);
    target.moves = join(target.moves, source.moves);
    for (const key of ["deleted", "onlyUnallocated"]) {
        if (source[key] !== null && (!before || target[key] === null))
            target[key] = source[key];
    }
    for (const submenu of source.submenus)
        addSubmenu(target, submenu);
}

// Inherits app and directory dirs and resolves them to priority order, best first.
function resolveMenu(menu, appDirs, directoryDirs) {
    appDirs = keepLast(appDirs.concat(menu.appDirs));
    directoryDirs = keepLast(directoryDirs.concat(menu.directoryDirs));
    for (const submenu of menu.submenus)
        resolveMenu(submenu, appDirs, directoryDirs);
    menu.appDirs = appDirs.slice().reverse();
    menu.directoryDirs = directoryDirs.slice().reverse();
    menu.directories = keepLast(menu.directories).reverse();
}

// Deepest menus first; within a menu, in order.
function handleMoves(menu) {
    for (const submenu of menu.submenus.slice())
        handleMoves(submenu);
    for (const move of menu.moves) {
        const origin = findMenu(menu, move.from);
        const names = move.to.split("/").filter(name => name);
        if (!origin || names.length === 0)
            continue;
        let parent = menu;
        for (const name of names.slice(0, -1))
            parent = findMenu(parent, name) || addSubmenu(parent, newMenu(name));
        const target = findMenu(parent, names[names.length - 1]);
        if (target === origin || isInside(parent, origin))
            continue;
        origin.parent.submenus.splice(origin.parent.submenus.indexOf(origin), 1);
        if (target) {
            mergeMenu(target, origin, true);
        } else {
            origin.name = names[names.length - 1];
            origin.parent = parent;
            parent.submenus.push(origin);
        }
    }
}

function findMenu(menu, path) {
    for (const name of path.split("/")) {
        if (!name)
            continue;
        menu = menu.submenus.find(submenu => submenu.name === name);
        if (!menu)
            return null;
    }
    return menu;
}

function isInside(menu, ancestor) {
    for (; menu; menu = menu.parent) {
        if (menu === ancestor)
            return true;
    }
    return false;
}

function removeDeleted(menu) {
    menu.submenus = menu.submenus.filter(submenu => submenu.deleted !== true);
    for (const submenu of menu.submenus)
        removeDeleted(submenu);
}

// ---------- Rules

// <Include>/<Exclude>: the rules inside are ORed.
function anyRule(node) {
    const tests = compileRules(node);
    return app => tests.some(test => test(app));
}

function compileRules(node) {
    return elements(node).map(compileRule).filter(test => test !== null);
}

function compileRule(node) {
    const text = textOf(node);
    switch (node.name) {
    case "All":
        return () => true;
    case "Category":
        return app => app.categories.indexOf(text) >= 0;
    case "Filename":
        return app => app.id + ".desktop" === text;
    case "And":
    case "Or":
    case "Not":
        break;
    default:
        return null;
    }
    const tests = compileRules(node);
    if (tests.length === 0)
        return null;
    if (node.name === "And")
        return app => tests.every(test => test(app));
    if (node.name === "Or")
        return app => tests.some(test => test(app));
    return app => !tests.some(test => test(app));
}

// ---------- Applications

// DMS's entries, with the application dirs that hold each desktop id and the file DMS loaded it from.
function indexApps(ctx, root) {
    const dmsDirs = ctx.dataDirs.map(dir => dir + "/applications");
    const dirs = dmsDirs.slice();
    const collect = menu => {
        for (const dir of menu.appDirs) {
            if (dirs.indexOf(dir) < 0)
                dirs.push(dir);
        }
        menu.submenus.forEach(collect);
    };
    collect(root);
    const files = {};
    for (const dir of dirs)
        scanApps(ctx, dir, dir, "", files, 0);
    return ctx.apps.map(entry => {
        const id = String(entry.id);
        const found = files[id] || {};
        const home = dmsDirs.find(dir => found[dir]);
        return {
            id: id,
            entry: entry,
            categories: toArray(entry.categories).map(String),
            dirs: found,
            path: home ? found[home] : null,
            shown: undefined
        };
    });
}

// Desktop ids: the path below the application dir, with "/" replaced by "-".
function scanApps(ctx, root, dir, prefix, files, depth) {
    for (const entry of ctx.list(dir)) {
        if (entry.dir) {
            if (depth < 8)
                scanApps(ctx, root, dir + "/" + entry.name, prefix + entry.name + "-", files, depth + 1);
        } else if (entry.name.endsWith(".desktop")) {
            const id = prefix + entry.name.slice(0, -8);
            (files[id] = files[id] || {})[root] = dir + "/" + entry.name;
        }
    }
}

// Two passes: regular menus first; <OnlyUnallocated> menus then get what no <Include> matched.
function allocate(root, apps) {
    const matched = {};
    const pass = (menu, unallocated) => {
        for (const submenu of menu.submenus)
            pass(submenu, unallocated);
        if ((menu.onlyUnallocated === true) !== unallocated)
            return;
        const pool = apps.filter(app => menu.appDirs.some(dir => app.dirs[dir]) && !(unallocated && matched[app.id]));
        menu.entries = pool.filter(app => {
            let included = false;
            for (const rule of menu.rules) {
                if (rule.test(app)) {
                    included = rule.include;
                    if (included && !unallocated)
                        matched[app.id] = true;
                }
            }
            return included;
        });
    };
    pass(root, false);
    pass(root, true);
}

// NoDisplay and Hidden apps are not in DMS's list; OnlyShowIn, NotShowIn and TryExec need the file.
function isShown(ctx, app) {
    if (app.shown === undefined) {
        const text = app.path ? ctx.read(app.path) : null;
        const entry = text === null ? null : parseShownKeys(text);
        app.shown = !entry || (shownIn(entry, ctx.desktops) && (!entry.TryExec || ctx.executable(entry.TryExec)));
    }
    return app.shown;
}

// ---------- Output

// Folders without visible applications, or whose .directory has NoDisplay or Hidden, are dropped.
function output(ctx, menu, id) {
    const node = {
        id: id,
        name: menu.name,
        icon: "",
        menus: [],
        apps: []
    };
    for (const submenu of menu.submenus) {
        const child = output(ctx, submenu, id ? id + "/" + submenu.name : submenu.name);
        if (child)
            node.menus.push(child);
    }
    for (const app of menu.entries) {
        if (isShown(ctx, app))
            node.apps.push(appNode(app.entry, app.id));
    }
    if (id && node.menus.length === 0 && node.apps.length === 0)
        return null;
    const directory = findDirectory(ctx, menu);
    if (directory) {
        if (id && (isTrue(directory.NoDisplay) || isTrue(directory.Hidden)))
            return null;
        node.name = localized(directory, "Name", ctx.langs) || node.name;
        node.icon = localized(directory, "Icon", ctx.langs);
    }
    node.menus = sortByName(node.menus, ctx.compare);
    node.apps = sortByName(node.apps, ctx.compare);
    return node;
}

// The last <Directory> that exists, looked up in the dirs by priority.
function findDirectory(ctx, menu) {
    for (const name of menu.directories) {
        for (const dir of menu.directoryDirs) {
            const path = dir + "/" + name;
            const text = ctx.read(path);
            const entry = text === null ? null : parseEntry(text);
            if (entry) {
                ctx.files[path] = true;
                return entry;
            }
        }
    }
    return null;
}

function appNode(entry, id) {
    return {
        id: id,
        name: String(entry.name || ""),
        genericName: String(entry.genericName || ""),
        comment: String(entry.comment || ""),
        icon: String(entry.icon || ""),
        keywords: toArray(entry.keywords).map(String)
    };
}

// Like glibc's collation: spaces and punctuation only break ties. Equal names keep their order.
function sortByName(items, compare) {
    const keyed = items.map((item, index) => ({
        item: item,
        index: index,
        key: item.name.replace(/[\s!-\/:-@\[-`{-~ -¿ -⁯　-〿！-／：-＠［-｀｛-･]/g, "")
    }));
    keyed.sort((a, b) => compare(a.key, b.key) || compare(a.item.name, b.item.name) || a.index - b.index);
    return keyed.map(entry => entry.item);
}

// ---------- Helpers

function toArray(value) {
    return value ? Array.prototype.slice.call(value) : [];
}

function normalize(path) {
    const parts = [];
    for (const part of path.split("/")) {
        if (part === "..")
            parts.pop();
        else if (part && part !== ".")
            parts.push(part);
    }
    return "/" + parts.join("/");
}

function resolvePath(file, path) {
    return normalize(path.charAt(0) === "/" ? path : file.slice(0, file.lastIndexOf("/")) + "/" + path);
}

// Keeps the last of duplicate entries, in order.
function keepLast(list) {
    return list.filter((item, index) => list.lastIndexOf(item) === index);
}
