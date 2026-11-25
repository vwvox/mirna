import { commands as listenerCommands } from "@anlg/plugin-transcription";

import { updateLessonDocument, useLessonDocument } from "./documents";
import { emptyLessonMarks, parseLessonMarks } from "./schema";
import type {
  LessonMark,
  LessonMarkKind,
  LessonMarksDocument,
  LessonQuestion,
} from "./types";

import { useLiveQuery } from "~/db";
import { loadCaptureLifecycleMarker } from "~/stt/capture-lifecycle-storage";

const EMPTY = emptyLessonMarks();

export function useLessonMarks(
  sessionId: string | null | undefined,
): LessonMarksDocument {
  return (
    useLessonDocument(sessionId, "lesson_marks", parseLessonMarks) ?? EMPTY
  );
}

function updateMarks(
  sessionId: string,
  update: (current: LessonMarksDocument) => LessonMarksDocument,
) {
  return updateLessonDocument(
    sessionId,
    "lesson_marks",
    parseLessonMarks,
    emptyLessonMarks,
    update,
  );
}

/**
 * Where "now" falls in the note's audio. A resumed recording appends to the audio that
 * is already there, so its own clock starts at that audio's length.
 */
export async function currentLessonAudioMs(
  sessionId: string,
  now = Date.now(),
): Promise<number | null> {
  let snapshot: Awaited<
    ReturnType<typeof listenerCommands.getCaptureSnapshot>
  > | null = null;
  try {
    snapshot = await listenerCommands.getCaptureSnapshot();
  } catch {
    snapshot = null;
  }
  const marker = await loadCaptureLifecycleMarker(sessionId).catch(() => null);
  const snapshotData = snapshot?.status === "ok" ? snapshot.data : null;
  const startedAt =
    snapshotData?.activeSessionId === sessionId && snapshotData.startedAtMs
      ? snapshotData.startedAtMs
      : (marker?.startedAt ?? null);
  if (!startedAt) return null;
  return Math.max(0, (marker?.audioOffsetMs ?? 0) + (now - startedAt));
}

export async function addLessonMark(
  sessionId: string,
  kind: LessonMarkKind,
  note = "",
): Promise<LessonMark | null> {
  const atMs = await currentLessonAudioMs(sessionId);
  if (atMs === null) return null;
  const mark: LessonMark = {
    id: crypto.randomUUID(),
    kind,
    atMs,
    note,
    createdAt: new Date().toISOString(),
  };
  await updateMarks(sessionId, (current) => ({
    ...current,
    marks: [...current.marks, mark].sort((a, b) => a.atMs - b.atMs),
  }));
  return mark;
}

export function updateLessonMarkNote(
  sessionId: string,
  markId: string,
  note: string,
) {
  return updateMarks(sessionId, (current) => ({
    ...current,
    marks: current.marks.map((mark) =>
      mark.id === markId ? { ...mark, note } : mark,
    ),
  }));
}

export function removeLessonMark(sessionId: string, markId: string) {
  return updateMarks(sessionId, (current) => ({
    ...current,
    marks: current.marks.filter((mark) => mark.id !== markId),
  }));
}

export async function addLessonQuestion(
  sessionId: string,
  text: string,
): Promise<LessonQuestion | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const question: LessonQuestion = {
    id: crypto.randomUUID(),
    text: trimmed,
    atMs: await currentLessonAudioMs(sessionId),
    asked: false,
    createdAt: new Date().toISOString(),
  };
  await updateMarks(sessionId, (current) => ({
    ...current,
    questions: [...current.questions, question],
  }));
  return question;
}

export function setLessonQuestionAsked(
  sessionId: string,
  questionId: string,
  asked: boolean,
) {
  return updateMarks(sessionId, (current) => ({
    ...current,
    questions: current.questions.map((question) =>
      question.id === questionId ? { ...question, asked } : question,
    ),
  }));
}

export function removeLessonQuestion(sessionId: string, questionId: string) {
  return updateMarks(sessionId, (current) => ({
    ...current,
    questions: current.questions.filter(
      (question) => question.id !== questionId,
    ),
  }));
}

type MarksRow = { session_id: string; body: string };

/** The marks and questions of several lessons, by lesson id. */
export function useCourseMarks(sessionIds: string[]) {
  const placeholders = sessionIds.map(() => "?").join(", ");
  const { data = EMPTY_MARKS } = useLiveQuery<
    MarksRow,
    Map<string, LessonMarksDocument>
  >({
    sql: `
      SELECT session_id, body FROM session_documents
      WHERE session_id IN (${placeholders || "''"})
        AND kind = 'lesson_marks' AND deleted_at IS NULL
    `,
    params: sessionIds,
    enabled: sessionIds.length > 0,
    mapRows: (rows) => {
      const marks = new Map<string, LessonMarksDocument>();
      for (const row of rows) {
        try {
          const parsed = parseLessonMarks(JSON.parse(row.body));
          if (parsed) marks.set(row.session_id, parsed);
        } catch {
          // Leave out marks that can't be read.
        }
      }
      return marks;
    },
  });
  return data;
}

const EMPTY_MARKS = new Map<string, LessonMarksDocument>();
