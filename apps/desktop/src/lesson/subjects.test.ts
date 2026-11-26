import { describe, expect, it } from "vitest";

import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { splitMath } from "./components/math";
import { transcriptionVerdict } from "./components/transcription-line";
import {
  buildFormulaLatex,
  buildSubjectMarkdown,
  dollarsToAnki,
  subjectCardItems,
} from "./export";
import { applyFormulaFixes } from "./fixes";
import {
  computeChineseStats,
  computeLanguageStats,
  languageShare,
} from "./language";
import {
  languageFacts,
  looksLikeLanguage,
  qwen3AsrSupports,
  readingHeading,
  splitArticle,
  usesPinyin,
} from "./languages";
import {
  buildPracticeCards,
  practiceCardId,
  practiceItemsOf,
} from "./practice";
import {
  lessonSubject,
  parseLessonFixes,
  parseLessonSettings,
  parseLessonSheetDocument,
} from "./schema";
import {
  aiSubjectSheetSchema,
  bareLatex,
  sourcesHeading,
  subjectSheetSystemPrompt,
  toSubjectSheet,
} from "./subject-sheet";
import type { LessonSheet } from "./types";

function line(
  text: string,
  startMs: number,
  endMs: number,
): RenderedTranscriptSegment {
  return {
    key: { channel: "DirectMic", speaker_index: null, speaker_human_id: null },
    speaker_label: "",
    start_ms: startMs,
    end_ms: endMs,
    text,
    words: [],
  } as unknown as RenderedTranscriptSegment;
}

const noMarks = { version: 1 as const, marks: [], questions: [] };

describe("language facts", () => {
  it("knows each script's reading and direction", () => {
    expect(languageFacts("es")).toMatchObject({
      script: "latin",
      reading: "none",
      articles: true,
    });
    expect(languageFacts("ja-JP")).toMatchObject({
      code: "ja",
      reading: "kana",
      pinyin: false,
    });
    expect(languageFacts("ar").rtl).toBe(true);
    expect(languageFacts("xx")).toMatchObject({ script: "latin" });
  });

  it("keeps pinyin for Mandarin and for lessons from before languages were set", () => {
    expect(usesPinyin("zh")).toBe(true);
    expect(usesPinyin(null)).toBe(true);
    expect(usesPinyin("ja")).toBe(false);
    expect(usesPinyin("yue")).toBe(false);
    expect(readingHeading("zh")).toBe("pinyin");
    expect(readingHeading("ja")).toBe("kana");
    expect(readingHeading("ru")).toBe("reading");
  });

  it("knows which languages Qwen3-ASR can transcribe, whatever the engine claims", () => {
    expect(qwen3AsrSupports(["ja", "en"])).toBe(true);
    expect(qwen3AsrSupports(["zh-CN"])).toBe(true);
    expect(qwen3AsrSupports(["ga", "en"])).toBe(false);
    expect(qwen3AsrSupports(["he"])).toBe(false);
    expect(qwen3AsrSupports(["uk"])).toBe(false);
  });

  it("sets a noun's article apart, so it can show lighter", () => {
    expect(splitArticle("la cocina", "es")).toEqual({
      article: "la",
      rest: "cocina",
    });
    expect(splitArticle("l'école", "fr")).toEqual({
      article: "l'",
      rest: "école",
    });
    expect(splitArticle("die Küche", "de")).toEqual({
      article: "die",
      rest: "Küche",
    });
    expect(splitArticle("ahora mismo", "es")).toBeNull();
    expect(splitArticle("la cocina", "en")).toBeNull();
  });

  it("tells a line's language by its script, and lets Latin-script lines through", () => {
    expect(looksLikeLanguage("台所はどこですか", "ja")).toBe(true);
    expect(looksLikeLanguage("Where is the kitchen?", "ja")).toBe(false);
    expect(looksLikeLanguage("кухня", "ru")).toBe(true);
    expect(looksLikeLanguage("la cocina", "es")).toBe(true);
  });
});

describe("share of the lesson in the language", () => {
  it("splits Spanish from English by common words", () => {
    const segments = [
      line("Estoy cansado porque la cocina está muy lejos", 0, 4_000),
      line("So that means you are tired because it is far", 4_000, 8_000),
      line("ok", 8_000, 8_500),
    ];
    const stats = computeLanguageStats(segments, undefined, {
      learning: "es",
      explainIn: "en",
    });
    expect(stats).not.toBeNull();
    expect(languageShare(stats!)).toBe(50);
  });

  it("splits Japanese from English by script", () => {
    const stats = computeLanguageStats(
      [line("台所 means kitchen", 0, 3_000), line("だいどころ", 3_000, 5_000)],
      undefined,
      { learning: "ja", explainIn: "en" },
    );
    expect(stats!.inLanguageMs).toBeGreaterThan(2_000);
  });

  it("says nothing when the two languages can't be told apart", () => {
    expect(
      computeLanguageStats(
        [line("Dia duit, conas atá tú", 0, 3_000)],
        undefined,
        {
          learning: "ga",
          explainIn: "en",
        },
      ),
    ).toBeNull();
    expect(
      computeLanguageStats([line("hello", 0, 1_000)], undefined, {
        learning: "en",
        explainIn: "en",
      }),
    ).toBeNull();
  });

  it("gives Chinese lessons the same numbers as before", () => {
    // Five characters against five syllables of English: half the line.
    const stats = computeChineseStats([
      line("我们都很好 we are fine", 0, 4_000),
    ]);
    expect(stats).toEqual({
      spokenMs: 4_000,
      chineseMs: 2_000,
      studentChineseMs: 0,
    });
  });
});

describe("lesson settings", () => {
  it("reads the kind of class, and treats old lessons as language lessons", () => {
    expect(parseLessonSettings('{"learning":"zh","explainIn":"en"}')).toEqual({
      learning: "zh",
      explainIn: "en",
    });
    expect(lessonSubject(null)).toBe("language");
    const topic = parseLessonSettings({
      learning: "en",
      explainIn: "en",
      subject: "topic",
      subjectName: "Contract law",
      leaveOut: ["ideas"],
    });
    expect(topic).toEqual({
      learning: "en",
      explainIn: "en",
      subject: "topic",
      subjectName: "Contract law",
      leaveOut: ["ideas"],
    });
    expect(lessonSubject(topic)).toBe("topic");
  });
});

describe("subject sheet", () => {
  it("parses old language sheets with empty subject parts", () => {
    const parsed = parseLessonSheetDocument({
      sheet: { summary: "Weather", vocabulary: [{ term: "天气" }] },
      generatedAt: "",
      model: "",
      sourceHash: "",
    });
    expect(parsed?.sheet.kind).toBe("language");
    expect(parsed?.sheet.keyTerms).toEqual([]);
    expect(parsed?.sheet.vocabulary[0]).toMatchObject({ note: "" });
  });

  it("asks for maths first in a maths class and leaves out unticked parts", () => {
    const maths = subjectSheetSystemPrompt({
      subject: "maths",
      subjectName: "Statistics",
      classLanguage: "English",
      leaveOut: ["slips"],
    });
    expect(maths).toContain("This class is about Statistics.");
    expect(maths).toContain("formulas and worked examples matter most");
    expect(maths).toContain("Leave these parts empty");
    expect(maths).toContain("slips");
    expect(maths).toMatch(/\bJSON\b/);
    const topic = subjectSheetSystemPrompt({
      subject: "topic",
      subjectName: "",
      classLanguage: "English",
    });
    expect(topic).toContain("a class on a topic");
    expect(topic).not.toContain("matter most");
  });

  it("maps the AI's answer, keeping formulas bare and every empty part empty", () => {
    const ai = aiSubjectSheetSchema.parse({
      topic: "Spread",
      keyTerms: [
        { term: "Variance", definition: "How spread out", heardAt: "19:40" },
        { term: "Variance", definition: "again" },
      ],
      formulas: [
        { name: "z-score", latex: "$z = \\frac{x - \\mu}{\\sigma}$" },
        { name: "empty", latex: "  " },
      ],
      sources: [{ name: "Hyde v Wrench", kind: "case", year: "1840" }],
      slips: [{ said: "32 ÷ 8", corrected: "32 ÷ 7", why: "n − 1" }],
      methods: [{ title: "No steps", steps: [] }],
    });
    const sheet = toSubjectSheet(ai, {
      knownTerms: new Set(["Variance"]),
      talk: null,
      marks: noMarks,
    });
    expect(sheet.kind).toBe("subject");
    expect(sheet.keyTerms).toEqual([
      {
        term: "Variance",
        definition: "How spread out",
        heardAtMs: 1_180_000,
        isNew: false,
      },
    ]);
    expect(sheet.formulas.map((formula) => formula.latex)).toEqual([
      "z = \\frac{x - \\mu}{\\sigma}",
    ]);
    expect(sheet.formulas[0]!.from).toBe("speech");
    expect(sheet.corrections[0]).toMatchObject({ said: "32 ÷ 8" });
    expect(sheet.methods).toEqual([]);
    expect(sheet.vocabulary).toEqual([]);
    expect(sourcesHeading(sheet.sources)).toBe("cases");
    expect(sourcesHeading([{ kind: "case" }, { kind: "person" }])).toBe(
      "people",
    );
  });

  it("strips the delimiters models wrap formulas in", () => {
    expect(bareLatex("$$x^2$$")).toBe("x^2");
    expect(bareLatex("\\(s^2\\)")).toBe("s^2");
    expect(bareLatex("\\[ a \\]")).toBe("a");
  });
});

describe("maths in text", () => {
  it("finds $…$ maths but leaves money alone", () => {
    expect(splitMath("Mean is $\\bar{x} = 5$ here")).toEqual([
      { kind: "text", text: "Mean is " },
      { kind: "math", latex: "\\bar{x} = 5", display: false },
      { kind: "text", text: " here" },
    ]);
    expect(splitMath("It costs $10 and $20 today")).toEqual([
      { kind: "text", text: "It costs $10 and $20 today" },
    ]);
    expect(splitMath("$$s = 2$$")).toEqual([
      { kind: "math", latex: "s = 2", display: true },
    ]);
  });
});

function subjectSheet(parts: Partial<LessonSheet>): LessonSheet {
  return {
    ...parseLessonSheetDocument({
      sheet: { kind: "subject" },
      generatedAt: "",
      model: "",
      sourceHash: "",
    })!.sheet,
    ...parts,
  };
}

describe("formula fixes", () => {
  const formulas = [
    {
      name: "Sample variance",
      latex: "s^2 = x",
      symbols: [],
      whenToUse: "",
      atMs: null,
      from: "speech" as const,
    },
    {
      name: "Mean",
      latex: "\\bar{x}",
      symbols: [],
      whenToUse: "",
      atMs: null,
      from: "notes" as const,
    },
  ];

  it("asks to check rebuilt formulas until the student has", () => {
    const before = applyFormulaFixes(formulas, null);
    expect(before.map((formula) => formula.needsCheck)).toEqual([true, false]);
    const fixes = parseLessonFixes({
      version: 1,
      formulas: { "Sample variance": { latex: "s^2 = y", at: "" } },
    });
    const after = applyFormulaFixes(formulas, fixes);
    expect(after[0]).toMatchObject({
      latex: "s^2 = y",
      checked: true,
      needsCheck: false,
    });
  });
});

describe("practice cards for every kind of sheet", () => {
  const sheet = subjectSheet({
    keyTerms: [
      {
        term: "Anomie",
        definition: "Normlessness",
        heardAtMs: 1_000,
        isNew: true,
      },
    ],
    checkYourself: [{ question: "Why?", answer: "Because", atMs: null }],
    formulas: [
      {
        name: "z-score",
        latex: "z",
        symbols: [],
        whenToUse: "Compare",
        atMs: null,
        from: "speech",
      },
    ],
    problems: [
      { question: "Find z", answer: "2", steps: ["$z = 18 / 9$"], atMs: null },
      { question: "No answer", answer: "", steps: [], atMs: null },
    ],
  });

  it("gives each kind its own id and leaves out problems with nothing to check", () => {
    const fixes = parseLessonFixes({
      version: 1,
      formulas: { "z-score": { latex: "z = 2", at: "" } },
    });
    const items = practiceItemsOf(sheet, fixes);
    expect(items.map((item) => [item.kind, item.id])).toEqual([
      ["term", "term:Anomie"],
      ["formula", "formula:z-score"],
      ["question", "q:Why?"],
      ["problem", "problem:Find z"],
    ]);
    expect(items[1]!.latex).toBe("z = 2");
    expect(items[3]!.steps).toEqual(["$z = 18 / 9$"]);
    expect(practiceCardId("word", "都")).toBe("都");
  });

  it("skips cards turned off on the sheet, by id", () => {
    const cards = buildPracticeCards([
      {
        sessionId: "s",
        items: practiceItemsOf(sheet),
        practice: { version: 1, cards: {}, skipped: ["term:Anomie"] },
      },
    ]);
    expect(cards.map((card) => card.id)).not.toContain("term:Anomie");
    expect(cards).toHaveLength(3);
  });
});

describe("exports for subject sheets", () => {
  it("turns $…$ into Anki's maths marks", () => {
    expect(dollarsToAnki("Find $z$ for $$x$$, costs $5")).toBe(
      "Find \\(z\\) for \\[x\\], costs $5",
    );
  });

  it("makes Anki cards, Markdown and LaTeX from the sheet", () => {
    const sheet = subjectSheet({
      summary: "Spread",
      keyTerms: [
        {
          term: "Variance",
          definition: "Spread",
          heardAtMs: null,
          isNew: true,
        },
      ],
      corrections: [{ said: "a", corrected: "b", why: "", atMs: null }],
    });
    const formulas = [
      { name: "Mean", latex: "\\bar{x}", whenToUse: "Average" },
    ];
    expect(subjectCardItems(sheet, formulas, "L7")).toEqual([
      { front: "Variance", back: "Spread", lesson: "L7" },
      { front: "Mean", back: "\\(\\bar{x}\\) · Average", lesson: "L7" },
    ]);
    const markdown = buildSubjectMarkdown("Lesson 7", sheet, formulas);
    expect(markdown).toContain("# Lesson 7");
    expect(markdown).toContain("- **Mean**: $\\bar{x}$ — Average");
    expect(markdown).toContain("## Common slips");
    expect(markdown).not.toContain("## Main ideas");
    expect(buildFormulaLatex("Stats", formulas)).toContain(
      "\\item Mean: \\[ \\bar{x} \\]",
    );
  });
});

describe("transcription on this Mac", () => {
  it("prefers Parakeet, then Qwen3-ASR, and offers the download when only Qwen3-ASR would do", () => {
    const yes = { supports: true, downloaded: true };
    const no = { supports: false, downloaded: true };
    expect(transcriptionVerdict({ parakeet: yes, qwen3: yes })).toEqual({
      kind: "ok",
      engine: "Parakeet",
    });
    expect(transcriptionVerdict({ parakeet: no, qwen3: yes })).toEqual({
      kind: "ok",
      engine: "Qwen3-ASR",
    });
    expect(
      transcriptionVerdict({
        parakeet: no,
        qwen3: { supports: true, downloaded: false },
      }),
    ).toEqual({ kind: "download", engine: "Qwen3-ASR" });
    expect(
      transcriptionVerdict({
        parakeet: no,
        qwen3: { supports: false, downloaded: true },
      }),
    ).toEqual({ kind: "none" });
  });
});
