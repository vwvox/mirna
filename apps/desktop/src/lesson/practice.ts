import { updateLessonDocument } from "./documents";
import { emptyLessonPractice, parseLessonPractice } from "./schema";
import type {
  LessonCardState,
  LessonPracticeDocument,
  LessonVocabularyItem,
} from "./types";

export type PracticeGrade = "again" | "hard" | "good" | "easy";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START_EASE = 2.5;
const MIN_EASE = 1.3;

/** A small SM-2 style schedule: misses come back in minutes, good answers spread out. */
export function scheduleCard(
  state: LessonCardState | undefined,
  grade: PracticeGrade,
  now: Date,
): LessonCardState {
  const ease = state?.ease ?? START_EASE;
  const reps = state?.reps ?? 0;
  const interval = state?.intervalDays ?? 0;
  const lapses = state?.lapses ?? 0;
  let nextInterval: number;
  let nextEase = ease;
  let nextReps = reps + 1;
  let dueMs: number;

  switch (grade) {
    case "again":
      nextInterval = 0;
      nextEase = Math.max(MIN_EASE, ease - 0.2);
      nextReps = 0;
      dueMs = now.getTime() + MINUTE;
      break;
    case "hard":
      nextInterval = reps === 0 ? 0 : Math.max(1, interval * 1.2);
      nextEase = Math.max(MIN_EASE, ease - 0.15);
      dueMs =
        reps === 0
          ? now.getTime() + 6 * MINUTE
          : now.getTime() + nextInterval * DAY;
      break;
    case "good":
      nextInterval =
        reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, interval) * ease;
      dueMs = now.getTime() + nextInterval * DAY;
      break;
    case "easy":
      nextInterval = (reps === 0 ? 4 : Math.max(1, interval) * ease) * 1.3;
      nextEase = ease + 0.15;
      dueMs = now.getTime() + nextInterval * DAY;
      break;
  }

  return {
    due: new Date(dueMs).toISOString(),
    intervalDays: Math.round(nextInterval * 100) / 100,
    ease: Math.round(nextEase * 100) / 100,
    reps: nextReps,
    lapses: grade === "again" && reps > 0 ? lapses + 1 : lapses,
    lastReviewedAt: now.toISOString(),
  };
}

/** How long until a card comes back, for the grade buttons. */
export function describeNext(
  state: LessonCardState | undefined,
  grade: PracticeGrade,
  now: Date,
): string {
  const next = scheduleCard(state, grade, now);
  const ms = new Date(next.due).getTime() - now.getTime();
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))} h`;
  return `${Math.round(ms / DAY)} d`;
}

export type PracticeCard = {
  id: string;
  sessionId: string;
  item: LessonVocabularyItem;
  state: LessonCardState | undefined;
};

export function isCardDue(card: PracticeCard, now: Date) {
  return !card.state || new Date(card.state.due).getTime() <= now.getTime();
}

export function buildPracticeCards(
  lessons: Array<{
    sessionId: string;
    vocabulary: LessonVocabularyItem[];
    practice: LessonPracticeDocument | null;
  }>,
  { includeSkipped = false }: { includeSkipped?: boolean } = {},
): PracticeCard[] {
  const seen = new Set<string>();
  const cards: PracticeCard[] = [];
  for (const lesson of lessons) {
    const skipped = new Set(lesson.practice?.skipped ?? []);
    for (const item of lesson.vocabulary) {
      if (seen.has(item.term)) continue;
      if (!includeSkipped && skipped.has(item.term)) continue;
      seen.add(item.term);
      cards.push({
        id: item.term,
        sessionId: lesson.sessionId,
        item,
        state: lesson.practice?.cards[item.term],
      });
    }
  }
  return cards;
}

/** Cards due now: ones seen before first (oldest due first), then new ones. */
export function dueCards(cards: PracticeCard[], now: Date): PracticeCard[] {
  const due = cards.filter((card) => isCardDue(card, now));
  return [
    ...due
      .filter((card) => card.state)
      .sort((a, b) => a.state!.due.localeCompare(b.state!.due)),
    ...due.filter((card) => !card.state),
  ];
}

export function recordPracticeGrade(
  card: PracticeCard,
  grade: PracticeGrade,
  now = new Date(),
): Promise<LessonPracticeDocument> {
  return updateLessonDocument(
    card.sessionId,
    "lesson_practice",
    parseLessonPractice,
    emptyLessonPractice,
    (current) => ({
      ...current,
      cards: {
        ...current.cards,
        [card.id]: scheduleCard(current.cards[card.id], grade, now),
      },
    }),
  );
}

export type WordState = "new" | "learning" | "known";

const KNOWN_AFTER_DAYS = 21;

/** New until first practised, known once it comes back three weeks or more apart. */
export function wordState(state: LessonCardState | undefined): WordState {
  if (!state) return "new";
  return state.intervalDays >= KNOWN_AFTER_DAYS ? "known" : "learning";
}

/** Puts a word away for two months, for words the student already knows well. */
export function markWordKnown(
  card: Pick<PracticeCard, "sessionId" | "id">,
  now = new Date(),
): Promise<LessonPracticeDocument> {
  return updateLessonDocument(
    card.sessionId,
    "lesson_practice",
    parseLessonPractice,
    emptyLessonPractice,
    (current) => {
      const previous = current.cards[card.id];
      return {
        ...current,
        cards: {
          ...current.cards,
          [card.id]: {
            due: new Date(now.getTime() + 60 * DAY).toISOString(),
            intervalDays: 60,
            ease: Math.max(previous?.ease ?? START_EASE, START_EASE),
            reps: Math.max(previous?.reps ?? 0, 3),
            lapses: previous?.lapses ?? 0,
            lastReviewedAt: now.toISOString(),
          },
        },
      };
    },
  );
}

/** Turns a word's practice card on or off on its lesson's sheet. */
export function setWordCard(
  sessionId: string,
  term: string,
  on: boolean,
): Promise<LessonPracticeDocument> {
  return updateLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
    emptyLessonPractice,
    (current) => {
      const skipped = new Set(current.skipped ?? []);
      if (on) skipped.delete(term);
      else skipped.add(term);
      return { ...current, skipped: [...skipped] };
    },
  );
}

const TONE_CHECKS_KEPT = 200;

/** Saves how each syllable's tone went, for "Tones you miss most". */
export function recordToneChecks(
  sessionId: string,
  checks: Array<{ tone: number; ok: boolean }>,
  now = new Date(),
): Promise<LessonPracticeDocument> {
  return updateLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
    emptyLessonPractice,
    (current) => ({
      ...current,
      toneChecks: [
        ...(current.toneChecks ?? []),
        ...checks.map((check) => ({ ...check, at: now.toISOString() })),
      ].slice(-TONE_CHECKS_KEPT),
    }),
  );
}

/** The tones missed most in the last `window` syllables checked, worst first. */
export function missedTones(
  checks: Array<{ tone: number; ok: boolean; at: string }>,
  window = 20,
): { tone: number; missed: number; of: number }[] {
  const recent = [...checks]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-window);
  const missed = new Map<number, number>();
  for (const check of recent) {
    if (!check.ok && check.tone > 0) {
      missed.set(check.tone, (missed.get(check.tone) ?? 0) + 1);
    }
  }
  return [...missed.entries()]
    .map(([tone, count]) => ({ tone, missed: count, of: recent.length }))
    .sort((a, b) => b.missed - a.missed);
}
