import { useEffect, useMemo, useState } from "react";

import { buildPracticeCards, dueCards, type PracticeCard } from "./practice";
import { parseLessonPractice, parseLessonSheetDocument } from "./schema";
import type { LessonPracticeDocument, LessonSheetDocument } from "./types";

import { useLiveQuery } from "~/db";

type Row = {
  session_id: string;
  kind: string;
  body: string;
  title: string;
  started: string;
};

function parse<T>(body: string, parser: (raw: unknown) => T | null) {
  try {
    return parser(JSON.parse(body));
  } catch {
    return null;
  }
}

export type PracticeLesson = {
  sessionId: string;
  title: string;
  started: string;
  sheet: LessonSheetDocument | null;
  practice: LessonPracticeDocument | null;
};

export function groupPracticeRows(rows: Row[]): PracticeLesson[] {
  const lessons = new Map<string, PracticeLesson>();
  for (const row of rows) {
    const lesson = lessons.get(row.session_id) ?? {
      sessionId: row.session_id,
      title: row.title,
      started: row.started,
      sheet: null,
      practice: null,
    };
    if (row.kind === "lesson_sheet") {
      lesson.sheet = parse(row.body, parseLessonSheetDocument);
    } else if (row.kind === "lesson_practice") {
      lesson.practice = parse(row.body, parseLessonPractice);
    }
    lessons.set(row.session_id, lesson);
  }
  return [...lessons.values()].sort((a, b) =>
    b.started.localeCompare(a.started),
  );
}

const EMPTY: PracticeLesson[] = [];

/** Study sheets and practice progress of the given lessons, newest lesson first. */
export function usePracticeLessons(sessionIds: string[]): PracticeLesson[] {
  const placeholders = sessionIds.map(() => "?").join(", ");
  const { data = EMPTY } = useLiveQuery<Row, PracticeLesson[]>({
    sql: `
      SELECT document.session_id, document.kind, document.body,
        session.title,
        COALESCE(NULLIF(session.started_at, ''), session.created_at) AS started
      FROM session_documents AS document
      JOIN sessions AS session ON session.id = document.session_id
      WHERE document.session_id IN (${placeholders || "''"})
        AND document.kind IN ('lesson_sheet', 'lesson_practice')
        AND document.deleted_at IS NULL AND session.deleted_at IS NULL
    `,
    params: sessionIds,
    enabled: sessionIds.length > 0,
    mapRows: groupPracticeRows,
  });
  return sessionIds.length > 0 ? data : EMPTY;
}

export function practiceCardsOf(
  lessons: PracticeLesson[],
  options?: { includeSkipped?: boolean },
): PracticeCard[] {
  return buildPracticeCards(
    lessons.map((lesson) => ({
      sessionId: lesson.sessionId,
      vocabulary: lesson.sheet?.sheet.vocabulary ?? [],
      practice: lesson.practice,
    })),
    options,
  );
}

/**
 * The cards to practise from one lesson's sheet: all of its words, plus words
 * from other lessons that were practised before and are due again. Words never
 * practised in other lessons wait for their own sheet.
 */
export function practiceCardsFor(
  lessons: PracticeLesson[],
  focusSessionId: string | undefined,
): PracticeCard[] {
  if (!focusSessionId) return practiceCardsOf(lessons);
  // This lesson first, so a word it shares with another lesson counts as its own.
  const ordered = [
    ...lessons.filter((lesson) => lesson.sessionId === focusSessionId),
    ...lessons.filter((lesson) => lesson.sessionId !== focusSessionId),
  ];
  return practiceCardsOf(ordered).filter(
    (card) => card.sessionId === focusSessionId || card.state !== undefined,
  );
}

/** The ids of every lesson, for practising across courses. */
export function useAllLessonIds(): string[] {
  const { data = NO_IDS } = useLiveQuery<{ id: string }, string[]>({
    sql: `
      SELECT id FROM sessions
      WHERE kind = 'lesson' AND deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(started_at, ''), created_at) DESC
    `,
    params: [],
    mapRows: (rows) => rows.map((row) => row.id),
  });
  return data;
}

const NO_IDS: string[] = [];

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * How many words are due now, and how many of those come from lessons other
 * than the focused one. Checked again every minute, as cards come due.
 */
export function usePracticeDue(
  sessionIds: string[],
  focusSessionId?: string,
): { cards: number; due: number; fromOtherLessons: number } {
  const lessons = usePracticeLessons(sessionIds);
  const now = useMinuteClock();
  return useMemo(() => {
    const cards = practiceCardsFor(lessons, focusSessionId);
    const due = dueCards(cards, now);
    return {
      cards: cards.length,
      due: due.length,
      fromOtherLessons: focusSessionId
        ? due.filter((card) => card.sessionId !== focusSessionId).length
        : 0,
    };
  }, [focusSessionId, lessons, now]);
}
