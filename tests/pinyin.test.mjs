import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// pinyin.js is a QML JavaScript library; drop the QML pragma and load it as a plain script.
const source = readFileSync(new URL("../pinyin.js", import.meta.url), "utf8").replace(/^\.pragma library$/m, "");
const Pinyin = new Function(`${source}\nreturn { toPinyin, matchScore };`)();

test("toPinyin converts Chinese app names to full pinyin and initials", () => {
    assert.deepEqual(Pinyin.toPinyin("计算器"), { full: "jisuanqi", initials: "jsq" });
    assert.deepEqual(Pinyin.toPinyin("微信"), { full: "weixin", initials: "wx" });
    assert.deepEqual(Pinyin.toPinyin("系统监视器"), { full: "xitongjianshiqi", initials: "xtjsq" });
});

test("toPinyin handles mixed ASCII and Chinese text", () => {
    assert.deepEqual(Pinyin.toPinyin("VSCode 编辑器"), { full: "vscodebianjiqi", initials: "vbjq" });
    assert.deepEqual(Pinyin.toPinyin(""), { full: "", initials: "" });
});

test("matchScore ranks direct matches above pinyin and keyword matches", () => {
    const makeApp = (name, terms = "") => {
        const py = Pinyin.toPinyin(name);
        return { key: name.toLowerCase(), terms, pinyinFull: py.full, pinyinInitials: py.initials };
    };
    const calc = makeApp("计算器", "math");
    const wx = makeApp("微信", "wechat");

    assert.equal(Pinyin.matchScore("计算", calc), 5);
    assert.equal(Pinyin.matchScore("算器", calc), 4);
    assert.equal(Pinyin.matchScore("jsq", calc), 3);
    assert.equal(Pinyin.matchScore("jisuan", calc), 3);
    assert.equal(Pinyin.matchScore("sq", calc), 2);
    assert.equal(Pinyin.matchScore("math", calc), 1);
    assert.equal(Pinyin.matchScore("wx", wx), 3);
    assert.equal(Pinyin.matchScore("zzz", calc), 0);
});
