import * as pinyinPro from "pinyin-pro";
import { describe, expect, it } from "vitest";

import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { correctionClips } from "./clips";
import { excerpt } from "./components/course-words";
import { sentenceAround } from "./components/practice-dialog";
import {
  buildCourseWords,
  type CourseLesson,
  courseProgress,
  filterCourseWords,
  practiceMinutes,
  sortCourseWords,
} from "./course-data";
import { buildPracticeCards, missedTones, wordState } from "./practice";
import { lessonRoles } from "./roles";
import { checkTones, toneFeedback, toneSyllables } from "./tones";
import type { LessonSheet, LessonVocabularyItem } from "./types";

function line(
  text: string,
  startMs: number,
  endMs: number,
  human: string | null = null,
): RenderedTranscriptSegment {
  return {
    id: `${startMs}`,
    key: { channel: "DirectMic", speaker_index: null, speaker_human_id: human },
    speaker_label: human ?? "Speaker 1",
    start_ms: startMs,
    end_ms: endMs,
    text,
    words: [
      {
        text,
        start_ms: startMs,
        end_ms: endMs,
        channel: "DirectMic",
        is_final: true,
      },
    ],
  } as RenderedTranscriptSegment;
}

function word(
  term: string,
  reading: string,
  meaning: string,
): LessonVocabularyItem {
  return { term, reading, meaning, heardAtMs: null, isNew: true };
}

function lesson(
  number: number,
  vocabulary: LessonVocabularyItem[],
  transcript: string[],
  practice: CourseLesson["practice"] = null,
): CourseLesson {
  const segments = transcript.map((text, index) =>
    line(text, index * 1000, index * 1000 + 900, "yan"),
  );
  return {
    sessionId: `l${number}`,
    title: `Lesson ${number}`,
    started: `2026-11-2${number}`,
    number,
    audioMs: 60_000,
    sheet: {
      sheet: {
        vocabulary,
        talk: null,
        homework: [],
      } as unknown as LessonSheet,
      generatedAt: "",
      model: "",
      sourceHash: "",
    },
    practice,
    transcript: { segments, roleOf: lessonRoles(segments, "me") },
    marks: {
      version: 1,
      marks: [],
      questions: [
        { id: "q", text: "?", atMs: null, asked: false, createdAt: "" },
      ],
    },
  };
}

const lessons = [
  lesson(1, [word("都", "dōu", "all")], ["我们都好", "都"]),
  lesson(
    2,
    [word("都", "dōu", "all"), word("天气", "tiānqì", "weather")],
    ["天气很好", "今天天气"],
    {
      version: 1,
      cards: {
        天气: {
          due: "2026-12-30T00:00:00Z",
          intervalDays: 30,
          ease: 2.5,
          reps: 4,
          lapses: 2,
          lastReviewedAt: "",
        },
      },
    },
  ),
];

describe("the course's words", () => {
  const words = buildCourseWords(lessons);

  it("counts how often each word was said and in which lessons", () => {
    const dou = words.find((item) => item.term === "都")!;
    expect(dou).toMatchObject({
      said: 2,
      inLessons: [true, true],
      first: 0,
      last: 1,
      state: "new",
    });
    const tianqi = words.find((item) => item.term === "天气")!;
    expect(tianqi).toMatchObject({
      said: 2,
      inLessons: [false, true],
      state: "known",
      lapses: 2,
    });
  });

  it("finds words by pinyin without tones, meaning or state, and sorts them", () => {
    expect(
      filterCourseWords(words, { query: "tianqi", filter: "all" }).map(
        (item) => item.term,
      ),
    ).toEqual(["天气"]);
    expect(
      filterCourseWords(words, { query: "ALL", filter: "all" }),
    ).toHaveLength(1);
    expect(
      filterCourseWords(words, { query: "", filter: "known" }),
    ).toHaveLength(1);
    expect(sortCourseWords(words, "hardest")[0]!.term).toBe("天气");
    expect(sortCourseWords(words, "newest")[0]!.term).toBe("天气");
    expect(sortCourseWords(words, "az").map((item) => item.term)).toEqual([
      "都",
      "天气",
    ]);
  });

  it("follows each lesson's words collected and open questions", () => {
    expect(
      courseProgress(lessons).map((item) => [
        item.number,
        item.wordsCollected,
        item.newWords,
        item.openQuestions,
      ]),
    ).toEqual([
      [1, 1, 1, 1],
      [2, 2, 1, 1],
    ]);
    expect(practiceMinutes(127)).toBe(53);
  });
});

describe("practice choices", () => {
  it("leaves out words whose card was turned off, unless asked", () => {
    const input = [
      {
        sessionId: "s",
        vocabulary: [word("都", "", ""), word("也", "", "")],
        practice: { version: 1 as const, cards: {}, skipped: ["也"] },
      },
    ];
    expect(buildPracticeCards(input).map((card) => card.id)).toEqual(["都"]);
    expect(
      buildPracticeCards(input, { includeSkipped: true }).map(
        (card) => card.id,
      ),
    ).toEqual(["都", "也"]);
  });

  it("calls words new, learning or known", () => {
    expect(wordState(undefined)).toBe("new");
    expect(
      wordState({
        due: "",
        intervalDays: 3,
        ease: 2.5,
        reps: 2,
        lapses: 0,
        lastReviewedAt: "",
      }),
    ).toBe("learning");
  });

  it("finds the tones missed most in the last checks", () => {
    const checks = [
      { tone: 3, ok: false, at: "1" },
      { tone: 3, ok: false, at: "2" },
      { tone: 2, ok: false, at: "3" },
      { tone: 1, ok: true, at: "4" },
    ];
    expect(missedTones(checks)).toEqual([
      { tone: 3, missed: 2, of: 4 },
      { tone: 2, missed: 1, of: 4 },
    ]);
  });
});

describe("corrections and sentences", () => {
  it("plays what the student said and the teacher's correction apart", () => {
    const segments = [
      line("jiāozi", 10_000, 11_000, "me"),
      line("jiǎozi, 饺子", 11_200, 13_000, "yan"),
    ];
    const clips = correctionClips(
      segments,
      lessonRoles(segments, "me"),
      10_500,
    );
    expect(clips.you).toEqual({ startMs: 9_800, endMs: 11_300 });
    expect(clips.teacher).toEqual({ startMs: 11_000, endMs: 13_300 });
  });

  it("finds the sentence a word was said in", () => {
    const segments = [line("Okay. 我们都很好。你呢？", 0, 6_000, "yan")];
    const found = sentenceAround(
      segments,
      lessonRoles(segments, "me"),
      { startMs: 2_000, endMs: 3_000 },
      "都",
    );
    expect(found?.text).toBe("我们都很好。");
  });

  it("shows the words around a term in a long line", () => {
    expect(excerpt("a".repeat(30) + "都" + "b".repeat(30), "都", 0)).toBe(
      `…${"a".repeat(14)}都${"b".repeat(14)}…`,
    );
  });
});

describe("tone feedback", () => {
  it("says what was heard and what to aim for", () => {
    const [jiao] = toneSyllables("饺子", pinyinPro, "jiǎozi");
    expect(jiao?.spoken).toBe("half-3");
    const [result] = checkTones([jiao!], [3, 3, 3.1, 3, 3]);
    expect(result!.ok).toBe(false);
    expect(toneFeedback(result!, pinyinPro)).toBe(
      "Yours stayed level, like jiāo. Keep it low; don't come back up.",
    );
  });

  it("takes tones from the sheet's reading, and reads a final 子 light", () => {
    expect(
      toneSyllables("饺子", pinyinPro, "jiǎozi").map((item) => [
        item.pinyin,
        item.tone,
      ]),
    ).toEqual([
      ["jiǎo", 3],
      ["zi", 0],
    ]);
    expect(toneSyllables("饺子", pinyinPro).map((item) => item.tone)).toEqual([
      3, 0,
    ]);
    // A reading that doesn't line up is ignored.
    expect(
      toneSyllables("天气", pinyinPro, "something").map((item) => item.tone),
    ).toEqual([1, 4]);
  });
});
