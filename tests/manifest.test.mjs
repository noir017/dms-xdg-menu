import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const translations = readdirSync(new URL("translations/", root)).filter(name => name.endsWith(".json"));

test("plugin.json", () => {
    const manifest = load("plugin.json");
    for (const key of ["id", "name", "description", "version", "author", "type", "capabilities", "component"])
        assert.ok(key in manifest, key);
    assert.equal(manifest.id, "xdgMenu");
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok(existsSync(new URL(manifest.component, root)));
});

test("translations are non-empty strings", () => {
    assert.ok(translations.length > 0);
    for (const name of translations) {
        for (const [context, terms] of Object.entries(load(`translations/${name}`))) {
            assert.equal(typeof terms, "object", `${name}: ${context}`);
            for (const text of Object.values(terms))
                assert.ok(typeof text === "string" && text, `${name}: ${context}`);
        }
    }
});

test("translations cover exactly the terms the widget uses", () => {
    const qml = readFileSync(new URL("XdgMenu.qml", root), "utf8");
    const used = new Set([...qml.matchAll(/I18n\.trFor\("xdgMenu", "([^"]+)"\)/g)].map(match => match[1]));
    for (const name of translations)
        assert.deepEqual(new Set(Object.keys(load(`translations/${name}`))), used, name);
});
