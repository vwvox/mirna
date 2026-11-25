import * as pinyinPro from "pinyin-pro";
import { pinyin } from "pinyin-pro";
import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeHan,
  annotatePinyin,
  effectiveChineseDisplay,
  hasHan,
  hanVocabularyTerms,
  matchesPinyinQuery,
  parseChineseDisplay,
  toPinyinQuery,
  useChineseDisplay,
} from "./pinyin";

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

describe("Chinese display preference", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("migrates the old pinyin switch", () => {
    expect(parseChineseDisplay("1")).toEqual({
      mode: "pinyin-above",
      toneColours: false,
      translation: false,
    });
    expect(parseChineseDisplay("0").mode).toBe("characters");
    expect(parseChineseDisplay(null).mode).toBe("characters");
  });

  it("reads saved choices and ignores unknown ones", () => {
    expect(
      parseChineseDisplay(
        JSON.stringify({
          mode: "word-by-word",
          toneColours: true,
          translation: true,
        }),
      ),
    ).toEqual({ mode: "word-by-word", toneColours: true, translation: true });
    expect(parseChineseDisplay('{"mode":"braille"}').mode).toBe("characters");
    expect(parseChineseDisplay("{not json").mode).toBe("characters");
  });

  it("saves every change in the same storage key", () => {
    useChineseDisplay.getState().update({ mode: "pinyin-only" });
    useChineseDisplay.getState().update({ toneColours: true });

    expect(
      parseChineseDisplay(localStorage.getItem("mirna:transcript-pinyin")),
    ).toEqual({ mode: "pinyin-only", toneColours: true, translation: false });
    useChineseDisplay
      .getState()
      .update({ mode: "characters", toneColours: false });
  });
});

describe("display for lessons", () => {
  const characters = {
    mode: "characters" as const,
    toneColours: false,
    translation: true,
  };

  it("shows lessons with pinyin above in tone colours until the student picks", () => {
    expect(
      effectiveChineseDisplay({ ...characters, chosen: false }, true),
    ).toEqual({ mode: "pinyin-above", toneColours: true, translation: true });
    expect(
      effectiveChineseDisplay({ ...characters, chosen: false }, false),
    ).toEqual(characters);
  });

  it("follows the student's pick everywhere once they've made one", () => {
    expect(
      effectiveChineseDisplay({ ...characters, chosen: true }, true),
    ).toEqual(characters);
  });
});

describe("analyzeHan", () => {
  it("splits Chinese into words with a toned syllable per character", () => {
    const tokens = analyzeHan("我们都很便宜，OK", pinyinPro);

    expect(tokens.map((token) => token.text)).toEqual(
      expect.arrayContaining(["我们", "便宜", "，OK"]),
    );
    expect(tokens.map((token) => token.text).join("")).toBe("我们都很便宜，OK");
    expect(tokens.find((token) => token.text === "便宜")?.syllables).toEqual([
      { pinyin: "pián", tone: 2 },
      { pinyin: "yi", tone: 0 },
    ]);
    expect(
      tokens
        .flatMap((token) => token.syllables ?? [])
        .map((syllable) => syllable.pinyin),
    ).toEqual(["wǒ", "men", "dōu", "hěn", "pián", "yi"]);
    expect(tokens.find((token) => token.text === "，OK")?.syllables).toBeNull();
  });

  it("keeps lesson vocabulary whole", () => {
    const terms = hanVocabularyTerms(["很便宜", "price", " 学习 "]);

    expect([...terms]).toEqual(["很便宜", "学习"]);
    expect(
      analyzeHan("都很便宜", pinyinPro, terms).map((token) => token.text),
    ).toEqual(["都", "很便宜"]);
  });
});

describe("pinyin search", () => {
  it("matches Chinese words by toneless pinyin", () => {
    const [dou] = analyzeHan("都", pinyinPro);
    const [lv] = analyzeHan("绿", pinyinPro);

    expect(matchesPinyinQuery(dou!.syllables!, "dou", false)).toBe(true);
    expect(matchesPinyinQuery(dou!.syllables!, "do", false)).toBe(true);
    expect(matchesPinyinQuery(dou!.syllables!, "do", true)).toBe(false);
    expect(matchesPinyinQuery(lv!.syllables!, "lv", true)).toBe(true);
    expect(matchesPinyinQuery(lv!.syllables!, "lu", true)).toBe(true);
  });

  it("treats only plain lower-case letters as pinyin", () => {
    expect(toPinyinQuery("dou")).toBe("dou");
    expect(toPinyinQuery("xi huan")).toBe("xihuan");
    expect(toPinyinQuery("lü")).toBe("lv");
    expect(toPinyinQuery("Dou")).toBeNull();
    expect(toPinyinQuery("都")).toBeNull();
    expect(toPinyinQuery("dou1")).toBeNull();
  });
});
