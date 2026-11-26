import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { computeTalkStats } from "./generate";
import { chineseShare, computeChineseStats } from "./language";
import { type PracticeCard, type WordState, wordState } from "./practice";
import { practiceCardsOf, type PracticeLesson } from "./practice-data";
import type { LessonRoleOf } from "./roles";
import type { LessonMarksDocument } from "./types";

/** A course's lesson with everything the course page shows about it, oldest first. */
export type CourseLesson = PracticeLesson & {
  number: number;
  audioMs: number;
  transcript: {
    segments: RenderedTranscriptSegment[];
    roleOf: LessonRoleOf;
  } | null;
  marks: LessonMarksDocument | null;
};

export function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function countIn(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (
    let index = text.indexOf(needle);
    index !== -1;
    index = text.indexOf(needle, index + needle.length)
  ) {
    count++;
  }
  return count;
}

/** Each lesson's transcript as one searchable string, lines kept apart. */
export function transcriptText(
  segments: RenderedTranscriptSegment[] | undefined,
): string {
  return (segments ?? [])
    .map((segment) => normalizeForSearch(segment.text))
    .join("\u0000");
}

export type CourseWord = {
  term: string;
  reading: string;
  meaning: string;
  /** Times said across every lesson's transcript. */
  said: number;
  /** For each lesson, oldest first: whether the word came up in it. */
  inLessons: boolean[];
  lessonCount: number;
  /** Index of the first and last lesson it came up in. */
  first: number;
  last: number;
  state: WordState;
  lapses: number;
  card: PracticeCard;
};

/**
 * Every word in the course's study sheets, with how often it was said and in
 * which lessons. A word counts as in a lesson when that lesson's sheet lists it
 * or its transcript has it.
 */
export function buildCourseWords(lessons: CourseLesson[]): CourseWord[] {
  const newestFirst = [...lessons].reverse();
  const cards = practiceCardsOf(newestFirst, { includeSkipped: true });
  const texts = lessons.map((lesson) =>
    transcriptText(lesson.transcript?.segments),
  );
  const listed = lessons.map(
    (lesson) =>
      new Set((lesson.sheet?.sheet.vocabulary ?? []).map((item) => item.term)),
  );

  return cards.map((card) => {
    const needle = normalizeForSearch(card.item.term);
    let said = 0;
    const inLessons = lessons.map((_, index) => {
      const times = countIn(texts[index]!, needle);
      said += times;
      return times > 0 || listed[index]!.has(card.item.term);
    });
    const first = inLessons.indexOf(true);
    return {
      term: card.item.term,
      reading: card.item.reading,
      meaning: card.item.meaning,
      said,
      inLessons,
      lessonCount: inLessons.filter(Boolean).length,
      first,
      last: inLessons.lastIndexOf(true),
      state: wordState(card.state),
      lapses: card.state?.lapses ?? 0,
      card,
    };
  });
}

export const WORD_SORTS = ["said", "newest", "hardest", "az"] as const;
export type WordSort = (typeof WORD_SORTS)[number];
export type WordFilter = "all" | WordState;

function plainPinyin(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Words matching a search (characters, pinyin with or without tones, meaning) and a state. */
export function filterCourseWords(
  words: CourseWord[],
  { query, filter }: { query: string; filter: WordFilter },
): CourseWord[] {
  const typed = query.trim().toLowerCase();
  const toneless = plainPinyin(typed);
  return words.filter((word) => {
    if (filter !== "all" && word.state !== filter) return false;
    if (!typed) return true;
    return (
      word.term.includes(typed) ||
      plainPinyin(word.reading).includes(toneless) ||
      word.meaning.toLowerCase().includes(typed)
    );
  });
}

export function sortCourseWords(
  words: CourseWord[],
  sort: WordSort,
): CourseWord[] {
  const sorted = [...words];
  const bySaid = (a: CourseWord, b: CourseWord) =>
    b.said - a.said || b.lessonCount - a.lessonCount;
  switch (sort) {
    case "said":
      return sorted.sort(bySaid);
    case "newest":
      return sorted.sort((a, b) => b.first - a.first || bySaid(a, b));
    case "hardest":
      return sorted.sort(
        (a, b) =>
          b.lapses - a.lapses ||
          (a.card.state?.ease ?? 99) - (b.card.state?.ease ?? 99) ||
          bySaid(a, b),
      );
    case "az":
      return sorted.sort((a, b) =>
        plainPinyin(a.reading || a.term).localeCompare(
          plainPinyin(b.reading || b.term),
        ),
      );
  }
}

export type LessonProgress = {
  sessionId: string;
  number: number;
  wordsCollected: number;
  newWords: number;
  /** Share of the lesson in Chinese, 0–100, or null without Chinese or a transcript. */
  chinese: number | null;
  /** The student's share of speaking time, 0–100, or null when voices weren't told apart. */
  spoke: number | null;
  openQuestions: number;
};

/** One row per lesson, oldest first, for the lessons list and the progress charts. */
export function courseProgress(lessons: CourseLesson[]): LessonProgress[] {
  const collected = new Set<string>();
  return lessons.map((lesson) => {
    const vocabulary = lesson.sheet?.sheet.vocabulary ?? [];
    let fresh = 0;
    for (const item of vocabulary) {
      if (!collected.has(item.term)) fresh++;
      collected.add(item.term);
    }
    const talk = lesson.transcript
      ? computeTalkStats(lesson.transcript.segments, lesson.transcript.roleOf)
      : (lesson.sheet?.sheet.talk ?? null);
    const chinese = lesson.transcript
      ? computeChineseStats(
          lesson.transcript.segments,
          lesson.transcript.roleOf,
        )
      : null;
    return {
      sessionId: lesson.sessionId,
      number: lesson.number,
      wordsCollected: collected.size,
      newWords: fresh,
      chinese: chinese ? chineseShare(chinese) : null,
      spoke: talk
        ? Math.round((talk.studentMs / (talk.studentMs + talk.teacherMs)) * 100)
        : null,
      openQuestions: (lesson.marks?.questions ?? []).filter(
        (question) => !question.asked,
      ).length,
    };
  });
}

/** About 25 seconds a word, rounded up to whole minutes. */
export function practiceMinutes(words: number): number {
  return Math.max(1, Math.ceil((words * 25) / 60));
}
