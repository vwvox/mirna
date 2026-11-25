import assert from "node:assert/strict";
import { test } from "node:test";
import { pinyin } from "pinyin-pro";

import { annotatePinyin, hasHan, wrapTokens } from "./pinyin-model.ts";

test("spots Chinese characters, not pinyin or other text", () => {
  assert.equal(hasHan("这个"), true);
  assert.equal(hasHan(" Now we say guì."), false);
  assert.equal(hasHan("Hello 贵 there"), true);
});

test("reads characters from context, and keeps other text together", () => {
  const parts = annotatePinyin("Now 便宜, ok", pinyin);
  assert.deepEqual(parts, [
    { text: "Now " },
    { text: "便", pinyin: "pián" },
    { text: "宜", pinyin: "yi" },
    { text: ", ok" },
  ]);
});

test("wraps a character or a word at a time", () => {
  const tokens = wrapTokens([
    { text: "We say " },
    { text: "贵", pinyin: "guì" },
    { text: " today" },
  ]);
  assert.deepEqual(tokens, [
    { text: "We " },
    { text: "say " },
    { text: "贵", pinyin: "guì" },
    { text: " " },
    { text: "today" },
  ]);
});
