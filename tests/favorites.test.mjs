import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// favorites.js is a QML JavaScript library; drop the QML pragma and load it as a plain script.
const source = readFileSync(new URL("../favorites.js", import.meta.url), "utf8").replace(/^\.pragma library$/m, "");
const Favorites = new Function(`${source}\nreturn { resolve, contains, toggle, reorder };`)();

const apps = ["calc", "editor", "maps"].map(id => ({ id, name: id }));

test("resolve keeps the saved order and skips removed apps", () => {
    const shown = Favorites.resolve(["maps", "gone", "calc"], apps);
    assert.deepEqual(shown.map(app => app.id), ["maps", "calc"]);
    assert.deepEqual(Favorites.resolve(undefined, apps), []);
});

test("toggle appends or removes without duplicates", () => {
    assert.deepEqual(Favorites.toggle([], "calc"), ["calc"]);
    assert.deepEqual(Favorites.toggle(["calc"], "maps"), ["calc", "maps"]);
    assert.deepEqual(Favorites.toggle(["calc", "maps"], "calc"), ["maps"]);
    assert.equal(Favorites.contains(["calc"], "calc"), true);
    assert.equal(Favorites.contains(null, "calc"), false);
});

test("reorder applies the drag result", () => {
    // Drag the third row to the top.
    assert.deepEqual(Favorites.reorder(["a", "b", "c"], ["a", "b", "c"], [2, 0, 1]), ["c", "a", "b"]);
});

test("reorder leaves removed apps in their slots", () => {
    const ids = ["a", "gone", "b", "c"];
    assert.deepEqual(Favorites.reorder(ids, ["a", "b", "c"], [1, 2, 0]), ["b", "gone", "c", "a"]);
});
