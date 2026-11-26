import { describe, expect, it } from "vitest";

import { courseHomework, homeworkTodoId } from "./homework";
import { dueCards } from "./practice";
import { type PracticeLesson, practiceCardsFor } from "./practice-data";
import type { LessonSheet, LessonVocabularyItem } from "./types";

const now = new Date("2026-11-25T12:00:00Z");

function word(term: string): LessonVocabularyItem {
  return { term, reading: "", meaning: "", note: "", heardAtMs: null, isNew: true };
}

function lesson(
  sessionId: string,
  terms: string[],
  practised: Record<string, string> = {},
): PracticeLesson {
  return {
    sessionId,
    title: sessionId,
    started: sessionId,
    settings: null,
    fixes: null,
    sheet: {
      sheet: { vocabulary: terms.map(word) } as LessonSheet,
      generatedAt: "",
      model: "",
      sourceHash: "",
    },
    practice: {
      version: 1,
      cards: Object.fromEntries(
        Object.entries(practised).map(([term, due]) => [
          term,
          {
            due,
            intervalDays: 1,
            ease: 2.5,
            reps: 1,
            lapses: 0,
            lastReviewedAt: "",
          },
        ]),
      ),
    },
  };
}

describe("practising from a lesson's sheet", () => {
  const lessons = [
    lesson("newer", ["天气", "冷"]),
    lesson("this", ["都", "冷"]),
    lesson("older", ["也", "饺子", "好"], {
      也: "2026-11-24T00:00:00Z",
      饺子: "2026-12-10T00:00:00Z",
    }),
  ];

  it("takes this lesson's words and earlier words that are due again", () => {
    const cards = practiceCardsFor(lessons, "this");
    expect(cards.map((card) => [card.id, card.sessionId])).toEqual([
      ["都", "this"],
      ["冷", "this"],
      ["也", "older"],
      ["饺子", "older"],
    ]);
    expect(dueCards(cards, now).map((card) => card.id)).toEqual([
      "也",
      "都",
      "冷",
    ]);
  });

  it("takes everything when practising a whole course", () => {
    expect(practiceCardsFor(lessons, undefined)).toHaveLength(6);
  });
});

describe("the course's homework", () => {
  it("lists every lesson's homework, open items first", () => {
    const statuses = new Map([
      [homeworkTodoId("s2", "Five sentences with 都"), "done"],
      [homeworkTodoId("s1", "Learn the finals"), "todo"],
    ]);
    const items = courseHomework(
      [
        {
          sessionId: "s2",
          title: "Lesson 2",
          homework: [
            { text: "Five sentences with 都", due: "Thursday" },
            { text: "Record yourself", due: "" },
          ],
        },
        {
          sessionId: "s1",
          title: "Lesson 1",
          homework: [{ text: "Learn the finals", due: "" }],
        },
      ],
      statuses,
    );
    expect(items.map((item) => [item.text, item.done])).toEqual([
      ["Record yourself", false],
      ["Learn the finals", false],
      ["Five sentences with 都", true],
    ]);
  });
});
