import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countOccurrences,
  findParagraphTranslation,
  placeChapters,
  translationKey,
  type TranscriptNote,
  TranscriptNoteProvider,
  useTranscriptNote,
} from "./note-context";
import { groupWordsIntoParagraphs } from "./utils";

import type { LessonSheet } from "~/lesson/types";

const mocks = vi.hoisted(() => ({
  sheet: null as LessonSheet | null,
}));

vi.mock("~/lesson/queries", () => ({
  useLessonSession: () => ({
    isLesson: false,
    settings: null,
    folderPath: "",
  }),
  useLessonSheet: (sessionId?: string) =>
    sessionId && mocks.sheet
      ? { sheet: mocks.sheet, generatedAt: "", model: "", sourceHash: "" }
      : null,
}));

afterEach(() => {
  cleanup();
  mocks.sheet = null;
});

describe("placeChapters", () => {
  const chapters = [
    { title: "Greetings", startMs: 0 },
    { title: "Prices", startMs: 61_000 },
    { title: "Numbers", startMs: 62_000 },
    { title: "Goodbye", startMs: 900_000 },
  ];

  it("puts each chapter over the first row at or after it", () => {
    const placed = placeChapters(chapters, [2_000, 60_000, 65_000], -Infinity);

    expect(placed.get(0)?.map((chapter) => chapter.title)).toEqual([
      "Greetings",
    ]);
    expect(placed.get(2)?.map((chapter) => chapter.title)).toEqual([
      "Prices",
      "Numbers",
    ]);
    expect(placed.has(1)).toBe(false);
  });

  it("leaves chapters an earlier capture already covers", () => {
    const placed = placeChapters(chapters, [800_000, 950_000], 65_000);

    expect([...placed.values()].flat().map((chapter) => chapter.title)).toEqual(
      ["Goodbye"],
    );
  });
});

describe("translations", () => {
  it("match a paragraph or its sentences without punctuation or spaces", () => {
    const translations = new Map([
      [translationKey("你好 ，世界！"), "Hello, world!"],
      [translationKey("谢谢。"), "Thanks."],
    ]);
    const paragraph = (texts: string[]) =>
      groupWordsIntoParagraphs(
        texts.map((text, index) => ({
          id: `word-${index}`,
          text,
          start_ms: index * 100,
          end_ms: index * 100 + 90,
          channel: "MixedCapture",
          is_final: true,
        })),
      )[0]!;

    expect(
      findParagraphTranslation(paragraph(["你好", "世界。"]), translations),
    ).toBe("Hello, world!");
    expect(
      findParagraphTranslation(
        paragraph(["你好世界。", "谢谢！"]),
        translations,
      ),
    ).toBe("Hello, world! Thanks.");
    expect(findParagraphTranslation(paragraph(["再见。"]), translations)).toBe(
      null,
    );
  });
});

describe("TranscriptNoteProvider", () => {
  it("serves the lesson sheet and counts a word across every capture", () => {
    mocks.sheet = createSheet();
    let note: TranscriptNote | null = null;
    function Probe() {
      note = useTranscriptNote();
      const { registerText } = note;
      useEffect(() => registerText("t1", () => "我们都很好"), [registerText]);
      useEffect(() => registerText("t2", () => "我们，我们"), [registerText]);
      return null;
    }

    render(
      <TranscriptNoteProvider
        sessionId="session-1"
        transcriptIds={["t1", "t2"]}
      >
        <Probe />
      </TranscriptNoteProvider>,
    );

    expect(note!.chapters.map((chapter) => chapter.title)).toEqual([
      "Start",
      "Later",
    ]);
    expect(note!.vocabulary.get("我们")?.meaning).toBe("we");
    expect([...note!.vocabularyTerms]).toEqual(["我们"]);
    expect(note!.translations.get(translationKey("我们都很好。"))).toBe(
      "We're all well.",
    );
    expect(note!.countInNote("我们")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
  });

  it("raises the chapter floor of each later capture", () => {
    let note: TranscriptNote | null = null;
    function Probe() {
      note = useTranscriptNote();
      return null;
    }

    render(
      <TranscriptNoteProvider transcriptIds={["t1", "t2", "t3"]}>
        <Probe />
      </TranscriptNoteProvider>,
    );
    act(() => {
      note!.reportLastRowStart("t1", 50_000);
      note!.reportLastRowStart("t2", 20_000);
    });

    expect(note!.chapterFloors.get("t1")).toBe(-Infinity);
    expect(note!.chapterFloors.get("t2")).toBe(50_000);
    expect(note!.chapterFloors.get("t3")).toBe(50_000);
  });
});

function createSheet(): LessonSheet {
  return {
    version: 1,
    kind: "language",
    keyTerms: [],
    ideas: [],
    sources: [],
    methods: [],
    checkYourself: [],
    formulas: [],
    workedExamples: [],
    problems: [],
    topic: "",
    summary: "",
    chapters: [
      { title: "Later", startMs: 60_000 },
      { title: "Start", startMs: 0 },
    ],
    vocabulary: [
      {
        term: "我们",
        reading: "wǒmen",
        meaning: "we",
        note: "",
        heardAtMs: null,
        isNew: true,
      },
      {
        term: "to be",
        reading: "",
        meaning: "ser",
        note: "",
        heardAtMs: null,
        isNew: false,
      },
    ],
    patterns: [],
    corrections: [],
    homework: [],
    markAnswers: [],
    openQuestions: [],
    translations: [{ text: "我们都很好。", translation: "We're all well." }],
    talk: null,
  };
}
