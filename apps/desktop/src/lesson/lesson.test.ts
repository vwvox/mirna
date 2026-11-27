import { describe, expect, it } from "vitest";

import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";
import { computeCurrentNoteTab, createEditorTabs } from "@anlg/utils/session";

import { findTermOccurrences, pickTermClip, recordingChannels } from "./clips";
import { summarizeTalk } from "./components/talk-strip";
import { buildAnkiText, buildPlecoText } from "./export";
import {
  aiSheetSchema,
  computeTalkStats,
  formatLessonTranscript,
  lessonSheetSystemPrompt,
  sheetMaxOutputTokens,
  toLessonSheet,
} from "./generate";
import { homeworkTodoId } from "./homework";
import { estimatePitch, toRelativeContour, trimSilence } from "./pitch";
import {
  buildPracticeCards,
  dueCards,
  scheduleCard,
  type PracticeCard,
} from "./practice";
import { parseLessonMarks, parseLessonSheetDocument } from "./schema";
import { formatClock, parseClock } from "./time";

function segment(
  channel: "DirectMic" | "RemoteParty",
  words: Array<[string, number, number]>,
): RenderedTranscriptSegment {
  return {
    id: `${channel}-${words[0]?.[1] ?? 0}`,
    key: { channel },
    start_ms: words[0]?.[1] ?? 0,
    end_ms: words[words.length - 1]?.[2] ?? 0,
    text: words.map(([text]) => text).join(""),
    speaker_label: channel === "DirectMic" ? "You" : "Speaker 1",
    words: words.map(([text, start, end]) => ({
      text,
      start_ms: start,
      end_ms: end,
      channel,
      is_final: true,
    })),
  } as RenderedTranscriptSegment;
}

describe("clock", () => {
  it("formats and reads back minutes and hours", () => {
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(parseClock("01:05")).toBe(65_000);
    expect(parseClock("[1:02:05]")).toBe(3_725_000);
    expect(parseClock("")).toBeNull();
    expect(parseClock("12:75")).toBeNull();
  });
});

describe("term clips", () => {
  const segments = [
    segment("RemoteParty", [
      ["面条好吃。", 1_000, 2_000],
      ["饺子", 2_100, 2_600],
    ]),
    segment("DirectMic", [["饺子好吃", 5_000, 6_000]]),
    segment("RemoteParty", [["我喜欢饺子。", 30_000, 31_500]]),
  ];

  it("finds a term inside and across Chinese word chunks", () => {
    const found = findTermOccurrences(segments, "饺子");
    expect(found.map((item) => [item.startMs, item.byTeacher])).toEqual([
      [2_100, true],
      [5_000, false],
      [30_000, true],
    ]);
    expect(findTermOccurrences(segments, "好吃")).toHaveLength(2);
  });

  it("plays the teacher's occurrence closest to when it was taught", () => {
    const found = findTermOccurrences(segments, "饺子");
    // Padded 0.3 s before and 0.6 s after; "我喜欢饺子。" is stretched from
    // 1.5 s to its five syllables' 1.65 s.
    expect(pickTermClip(found, 29_000)).toEqual({
      startMs: 29_700,
      endMs: 32_250,
      channel: 1,
    });
    expect(pickTermClip(found, null)?.startMs).toBe(1_800);
    expect(pickTermClip([], 0)).toBeNull();
  });

  it("plays only the speaker's side of a call recorded on the Mac", () => {
    const found = findTermOccurrences(segments, "饺子");
    // The mic is the left channel, the call the right.
    expect(found.map((item) => item.channel)).toEqual([1, 0, 1]);
  });

  it("plays both sides when the voices share one channel", () => {
    const phone = segments.map((item) => ({
      ...item,
      key: { ...item.key, channel: "DirectMic" as const },
    }));
    expect(
      findTermOccurrences(phone, "饺子").map((item) => item.channel),
    ).toEqual([null, null, null]);
    expect(recordingChannels(phone)(phone[0]!)).toBeNull();
  });
});

describe("study sheet", () => {
  it("labels the teacher and student and adds times to the transcript", () => {
    const text = formatLessonTranscript([
      segment("RemoteParty", [["都好吃。", 61_000, 62_000]]),
      segment("DirectMic", [["都好吃", 63_000, 64_000]]),
    ]);
    expect(text).toBe("[01:01] Teacher: 都好吃。\n[01:03] Student: 都好吃");
  });

  it("gives a long talk a time about every 20 s, at sentence ends", () => {
    // A minute of the teacher talking, a sentence every 8 s, as one turn.
    const words: Array<[string, number, number]> = [];
    for (let second = 0; second < 64; second += 2) {
      const ends = second % 8 === 6;
      words.push([
        `${second === 0 ? "" : " "}w${second}${ends ? "." : ""}`,
        second * 1_000,
        second * 1_000 + 2_000,
      ]);
    }
    const lines = formatLessonTranscript([
      segment("RemoteParty", words),
      segment("DirectMic", [["Okay.", 70_000, 70_400]]),
    ])
      .split("\n")
      .slice(0, -1);
    expect(lines.map((line) => line.slice(0, 7))).toEqual([
      "[00:00]",
      "[00:24]",
      "[00:48]",
    ]);
    expect(lines[0]).toBe(
      "[00:00] Teacher: w0 w2 w4 w6. w8 w10 w12 w14. w16 w18 w20 w22.",
    );
    // Nothing is lost or doubled between the pieces.
    expect(
      lines
        .map((line) => line.replace(/^\[\d\d:\d\d\] Teacher: /, ""))
        .join(" "),
    ).toBe(words.map(([text]) => text).join(""));
  });

  it("measures who talked from the channels", () => {
    expect(
      computeTalkStats([
        segment("RemoteParty", [["a", 0, 3_000]]),
        segment("DirectMic", [["b", 3_000, 4_000]]),
      ]),
    ).toEqual({ studentMs: 1_000, teacherMs: 3_000 });
    expect(computeTalkStats([])).toBeNull();
  });

  it("asks for JSON and spells out the sheet's shape for models without structured output", () => {
    const system = lessonSheetSystemPrompt("zh", "en");
    expect(system).toMatch(/\bJSON\b/);
    expect(system).toContain('"vocabulary"');
    expect(system).toContain('"markAnswers"');
    expect(system).toContain("Keep terms and examples in Chinese");
    expect(system).toContain("reading: Pinyin with tone marks.");
    expect(system).not.toMatch(/LEARNING|EXPLAIN_IN|READING_RULE|ARTICLE_RULE/);
  });

  it("asks for the reading each script needs, and articles where nouns have them", () => {
    const spanish = lessonSheetSystemPrompt("es", "en");
    expect(spanish).toContain(
      "Leave it empty: Spanish is written in Latin letters.",
    );
    expect(spanish).toContain("with their article");
    expect(spanish).toContain("la cocina, el mercado");
    const japanese = lessonSheetSystemPrompt("ja", "en");
    expect(japanese).toContain("hiragana");
    expect(japanese).not.toContain("with their article");
    expect(lessonSheetSystemPrompt("ru", "en")).toContain(
      "acute accent on the stressed vowel",
    );
  });

  it("leaves the answer length to the model except where Anthropic needs a cap", () => {
    const model = (provider: string) =>
      ({ provider }) as unknown as Parameters<typeof sheetMaxOutputTokens>[0];
    expect(sheetMaxOutputTokens(model("deepseek.chat"))).toBeUndefined();
    expect(sheetMaxOutputTokens(model("anthropic.messages"))).toBe(64_000);
  });

  it("accepts an answer that leaves out empty parts", () => {
    const answer = aiSheetSchema.parse({
      summary: "Weather words",
      vocabulary: [{ term: "天气", meaning: "weather" }],
    });
    expect(answer.homework).toEqual([]);
    expect(answer.topic).toBe("");
    expect(answer.vocabulary[0]).toMatchObject({ reading: "", heardAt: "" });
  });

  it("turns the model's answer into a sheet with times, new words and real marks only", () => {
    const sheet = toLessonSheet(
      {
        topic: " 都 (all) and negation ",
        summary: " Practised 都. ",
        chapters: [
          { title: "Negatives", start: "13:10" },
          { title: "Intro", start: "00:30" },
          { title: "No time", start: "" },
        ],
        vocabulary: [
          {
            term: "饺子",
            reading: "jiǎozi",
            meaning: "dumplings",
            note: "",
            heardAt: "12:49",
          },
          {
            term: "饺子",
            reading: "jiǎozi",
            meaning: "dup",
            note: "",
            heardAt: "",
          },
          { term: "也", reading: "yě", meaning: "also", note: "", heardAt: "" },
        ],
        patterns: [],
        corrections: [
          {
            said: "jiāozi",
            corrected: "jiǎozi",
            why: "third tone",
            at: "12:58",
          },
          { said: "", corrected: "x", why: "", at: "" },
        ],
        homework: [{ text: "Five sentences", due: "Thursday", at: "20:47" }],
        markAnswers: [
          { markId: "m1", answer: "Explained at 18:40" },
          { markId: "invented", answer: "Nope" },
        ],
        openQuestions: ["  ", "每?"],
        translations: [{ text: "都好吃。", translation: "Both are tasty." }],
      },
      {
        knownTerms: new Set(["也"]),
        talk: null,
        marks: {
          version: 1,
          questions: [],
          marks: [
            { id: "m1", kind: "confused", atMs: 1, note: "", createdAt: "" },
          ],
        },
      },
    );
    expect(sheet.topic).toBe("都 (all) and negation");
    expect(sheet.summary).toBe("Practised 都.");
    expect(sheet.chapters).toEqual([
      { title: "Intro", startMs: 30_000 },
      { title: "Negatives", startMs: 790_000 },
    ]);
    expect(sheet.vocabulary.map((item) => [item.term, item.isNew])).toEqual([
      ["饺子", true],
      ["也", false],
    ]);
    expect(sheet.vocabulary[0]?.heardAtMs).toBe(769_000);
    expect(sheet.corrections).toHaveLength(1);
    expect(sheet.markAnswers).toEqual([
      { markId: "m1", answer: "Explained at 18:40" },
    ]);
    expect(sheet.openQuestions).toEqual(["每?"]);
    expect(sheet.homework[0]).toEqual({
      text: "Five sentences",
      due: "Thursday",
      atMs: 1_247_000,
    });
  });
});

describe("stored documents", () => {
  it("reads marks leniently and rejects what isn't a marks document", () => {
    expect(
      parseLessonMarks({
        marks: [{ id: "a", kind: "important", atMs: 5 }],
      }),
    ).toEqual({
      version: 1,
      marks: [{ id: "a", kind: "important", atMs: 5, note: "", createdAt: "" }],
      questions: [],
    });
    expect(parseLessonMarks("nope")).toBeNull();
  });

  it("keeps a sheet readable when optional parts are missing", () => {
    const parsed = parseLessonSheetDocument({
      sheet: { summary: "x" },
      generatedAt: "now",
      model: "m",
      sourceHash: "h",
    });
    expect(parsed?.sheet.vocabulary).toEqual([]);
    expect(parsed?.sheet.talk).toBeNull();
  });
});

describe("practice", () => {
  const now = new Date("2026-11-25T12:00:00Z");

  it("brings a missed card back in a minute and spreads good answers out", () => {
    const again = scheduleCard(undefined, "again", now);
    expect(new Date(again.due).getTime() - now.getTime()).toBe(60_000);
    const first = scheduleCard(undefined, "good", now);
    expect(first.intervalDays).toBe(1);
    const second = scheduleCard(first, "good", now);
    expect(second.intervalDays).toBe(3);
    const third = scheduleCard(second, "good", now);
    expect(third.intervalDays).toBe(7.5);
    const lapse = scheduleCard(third, "again", now);
    expect(lapse.lapses).toBe(1);
    expect(lapse.ease).toBeLessThan(third.ease);
  });

  it("shows due cards seen before first, then new ones, without repeats", () => {
    const cards = buildPracticeCards([
      {
        sessionId: "s2",
        vocabulary: [
          {
            term: "新",
            reading: "",
            meaning: "",
            note: "",
            heardAtMs: null,
            isNew: true,
          },
          {
            term: "旧",
            reading: "",
            meaning: "",
            note: "",
            heardAtMs: null,
            isNew: true,
          },
        ],
        practice: {
          version: 1,
          cards: {
            旧: {
              due: "2026-11-24T00:00:00Z",
              intervalDays: 1,
              ease: 2.5,
              reps: 1,
              lapses: 0,
              lastReviewedAt: "",
            },
          },
        },
      },
      {
        sessionId: "s1",
        vocabulary: [
          {
            term: "新",
            reading: "",
            meaning: "",
            note: "",
            heardAtMs: null,
            isNew: true,
          },
        ],
        practice: null,
      },
    ]);
    expect(cards).toHaveLength(2);
    expect(dueCards(cards, now).map((card: PracticeCard) => card.id)).toEqual([
      "旧",
      "新",
    ]);
  });
});

describe("exports", () => {
  const items = [
    {
      term: "饺子",
      reading: "jiǎozi",
      meaning: "dumplings\tsteamed",
      note: "",
      heardAtMs: null,
      isNew: true,
      lesson: "Lesson 14",
    },
  ];

  it("writes Anki's text import with its header lines", () => {
    expect(buildAnkiText(items)).toBe(
      "#separator:tab\n#html:false\n#tags column:4\n饺子\tjiǎozi · dumplings steamed\t\tLesson_14\n",
    );
  });

  it("writes Pleco's headword, pinyin and definition lines", () => {
    expect(buildPlecoText(items)).toBe("饺子\tjiǎozi\tdumplings steamed\n");
  });
});

describe("homework to-dos", () => {
  it("gives the same homework the same id, so it is added once", () => {
    expect(homeworkTodoId("s", "Write five sentences")).toBe(
      homeworkTodoId("s", "Write five sentences"),
    );
    expect(homeworkTodoId("s", "a")).not.toBe(homeworkTodoId("s", "b"));
  });
});

describe("pitch", () => {
  it("finds the pitch of a voiced frame and ignores silence", () => {
    const rate = 16_000;
    const samples = new Float32Array(2048).map(
      (_, index) => Math.sin((2 * Math.PI * 200 * index) / rate) * 0.5,
    );
    expect(estimatePitch(samples, rate)).toBeCloseTo(200, -1);
    expect(estimatePitch(new Float32Array(2048), rate)).toBeNull();
  });

  it("compares contours relative to each voice and drops edge silence", () => {
    const contour = toRelativeContour([null, 100, 200, null]);
    expect(contour[0]).toBeNull();
    expect(contour[1]).toBeCloseTo(-12);
    expect(contour[2]).toBeCloseTo(0);
    expect(trimSilence(contour)).toHaveLength(2);
  });
});

describe("talk strip", () => {
  it("summarizes seconds of talking into buckets", () => {
    const samples = [
      { mic: true, speaker: false },
      { mic: false, speaker: true },
      { mic: false, speaker: true },
      { mic: false, speaker: true },
    ];
    expect(summarizeTalk(samples, 2)).toEqual([
      { mic: 0.5, speaker: 0.5 },
      { mic: 0, speaker: 1 },
    ]);
  });
});

describe("note tabs", () => {
  it("adds the study sheet first and opens on it for a finished lesson", () => {
    expect(
      createEditorTabs({
        enhancedNoteIds: ["summary"],
        canShowTranscript: true,
        hasLesson: true,
      }).map((view) => view.type),
    ).toEqual(["lesson", "enhanced", "raw", "transcript"]);
    expect(
      computeCurrentNoteTab(null, false, ["summary"], true, [], true),
    ).toEqual({
      type: "lesson",
    });
    expect(
      computeCurrentNoteTab(
        { type: "raw" },
        false,
        ["summary"],
        true,
        [],
        true,
      ),
    ).toEqual({ type: "raw" });
    expect(
      computeCurrentNoteTab(
        { type: "lesson" },
        true,
        ["summary"],
        true,
        [],
        true,
      ),
    ).toEqual({ type: "raw" });
    expect(
      computeCurrentNoteTab(
        { type: "lesson" },
        false,
        ["summary"],
        true,
        [],
        false,
      ),
    ).toEqual({ type: "raw" });
  });
});
