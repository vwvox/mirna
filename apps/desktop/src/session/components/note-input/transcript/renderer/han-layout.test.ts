import * as pinyinPro from "pinyin-pro";
import { describe, expect, it } from "vitest";

import {
  findPinyinMatches,
  getTokenPieces,
  getWordGlyphs,
  layoutHanLine,
  romanisePunctuation,
} from "./han-layout";

describe("layoutHanLine", () => {
  it("skips lines without Chinese", () => {
    expect(layoutHanLine(["Hello", "there."], pinyinPro)).toBeNull();
  });

  it("reads a word split across transcript words in context", () => {
    const line = layoutHanLine(["很便", "宜。"], pinyinPro)!;

    expect(
      getWordGlyphs(line, 1).map((glyph) => [
        glyph.text,
        glyph.syllable?.pinyin,
      ]),
    ).toEqual([
      ["宜", "yi"],
      ["。", undefined],
    ]);
    expect(getWordGlyphs(line, 0)[1]?.syllable?.pinyin).toBe("pián");
  });

  it("marks where pinyin-only text needs a space between words", () => {
    const line = layoutHanLine(["我们", "便宜"], pinyinPro)!;

    expect(
      [...getWordGlyphs(line, 0), ...getWordGlyphs(line, 1)].map(
        (glyph) => glyph.spaceBefore,
      ),
    ).toEqual([false, false, true, false]);
  });

  it("finds the transcript words under each Chinese word", () => {
    const line = layoutHanLine(["我", "们", "OK"], pinyinPro)!;
    const word = line.tokens.find((token) => token.text === "我们")!;

    expect(getTokenPieces(line, word)).toEqual([
      { wordIndex: 0, text: "我" },
      { wordIndex: 1, text: "们" },
    ]);
    expect(findPinyinMatches(line, "women", true)).toEqual([[0, 1]]);
    expect(findPinyinMatches(line, "dou", false)).toEqual([]);
  });
});

describe("romanisePunctuation", () => {
  it("sets Chinese punctuation the way romanised text reads", () => {
    expect(romanisePunctuation("，。？")).toBe(", . ? ");
  });
});
