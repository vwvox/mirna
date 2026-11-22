import { pinyin } from "pinyin-pro";
import { describe, expect, it } from "vitest";

import { annotatePinyin, hasHan } from "./pinyin";

describe("annotatePinyin", () => {
  it("reads characters in context and passes everything else through", () => {
    expect(annotatePinyin("很便宜，出差了。OK", { pinyin })).toEqual([
      { text: "很", pinyin: "hěn" },
      { text: "便", pinyin: "pián" },
      { text: "宜", pinyin: "yi" },
      { text: "，" },
      { text: "出", pinyin: "chū" },
      { text: "差", pinyin: "chāi" },
      { text: "了", pinyin: "le" },
      { text: "。OK" },
    ]);
  });

  it("spots Chinese text", () => {
    expect(hasHan("Verb plus 了")).toBe(true);
    expect(hasHan("Past tense.")).toBe(false);
  });
});
