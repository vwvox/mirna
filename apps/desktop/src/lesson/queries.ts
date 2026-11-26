import { useLessonDocument } from "./documents";
import { parseLessonSettings, parseLessonSheetDocument } from "./schema";
import { titleWithTopic } from "./title";
import type { LessonSettings, LessonSheetDocument } from "./types";

import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";

export const LESSON_SESSION_KIND = "lesson";

export type LessonSessionInfo = {
  isLesson: boolean;
  settings: LessonSettings | null;
  folderPath: string;
};

type LessonSessionRow = {
  kind: string | null;
  lesson: string | null;
  folder_path: string | null;
};

const LESSON_SESSION_SQL = `
  SELECT kind, json_extract(metadata_json, '$.lesson') AS lesson, folder_path
  FROM sessions
  WHERE id = ? AND deleted_at IS NULL
  LIMIT 1
`;

const NOT_A_LESSON: LessonSessionInfo = {
  isLesson: false,
  settings: null,
  folderPath: "",
};

function toLessonInfo(row: LessonSessionRow | undefined): LessonSessionInfo {
  if (!row || row.kind !== LESSON_SESSION_KIND) return NOT_A_LESSON;
  return {
    isLesson: true,
    settings: parseLessonSettings(row.lesson),
    folderPath: row.folder_path ?? "",
  };
}

export function useLessonSession(
  sessionId: string | null | undefined,
): LessonSessionInfo {
  const { data = NOT_A_LESSON } = useLiveQuery<
    LessonSessionRow,
    LessonSessionInfo
  >({
    sql: LESSON_SESSION_SQL,
    params: [sessionId ?? ""],
    enabled: Boolean(sessionId),
    mapRows: (rows) => toLessonInfo(rows[0]),
  });
  return sessionId ? data : NOT_A_LESSON;
}

export async function loadLessonSession(
  sessionId: string,
): Promise<LessonSessionInfo> {
  const rows = await liveQueryClient.execute<LessonSessionRow>(
    LESSON_SESSION_SQL,
    [sessionId],
  );
  return toLessonInfo(rows[0]);
}

/** The settings of a course's latest lesson, for the next one in it. */
export async function loadCourseSettings(
  folderPath: string,
): Promise<LessonSettings | null> {
  if (!folderPath) return null;
  const rows = await liveQueryClient.execute<{ lesson: string | null }>(
    `
      SELECT json_extract(metadata_json, '$.lesson') AS lesson
      FROM sessions
      WHERE folder_path = ? AND kind = 'lesson' AND deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(started_at, ''), created_at) DESC
      LIMIT 1
    `,
    [folderPath],
  );
  return parseLessonSettings(rows[0]?.lesson ?? null);
}

export function markSessionAsLesson(
  sessionId: string,
  settings: LessonSettings,
): Promise<void> {
  return enqueueDatabaseWrite(`lesson-session:${sessionId}`, async () => {
    await executeTransaction([
      {
        sql: `
          UPDATE sessions
          SET kind = ?,
            metadata_json = json_set(
              CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
              '$.lesson',
              json(?)
            ),
            updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `,
        params: [
          LESSON_SESSION_KIND,
          JSON.stringify(settings),
          new Date().toISOString(),
          sessionId,
        ],
      },
    ]);
  });
}

/** Names a lesson still called "Lesson 5" after its topic; other titles stay. */
export function renameLessonWithTopic(
  sessionId: string,
  topic: string,
): Promise<void> {
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    const rows = await liveQueryClient.execute<{ title: string }>(
      "SELECT title FROM sessions WHERE id = ? AND deleted_at IS NULL",
      [sessionId],
    );
    const title = rows[0]?.title ?? "";
    const renamed = titleWithTopic(title, topic);
    if (!renamed) return;
    await executeTransaction([
      {
        sql: `
          UPDATE sessions SET title = ?, updated_at = ?
          WHERE id = ? AND title = ? AND deleted_at IS NULL
        `,
        params: [renamed, new Date().toISOString(), sessionId, title],
      },
    ]);
  });
}

export function useLessonSheet(
  sessionId: string | null | undefined,
): LessonSheetDocument | null {
  return useLessonDocument(sessionId, "lesson_sheet", parseLessonSheetDocument);
}

export type CourseLessonRow = {
  id: string;
  title: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  audio_ms: number | null;
};

// The recorded length, as the sidebar shows it: the note can stay open well
// after the recording stops, so started/ended times overstate it. Phone
// recordings don't keep that, so they fall back to the transcript's last word.
const COURSE_LESSONS_SQL = `
  SELECT id, title, created_at, started_at, ended_at,
    COALESCE(NULLIF((
      SELECT SUM(CAST(json_extract(capture.value, '$.ended_at_ms') AS INTEGER))
      FROM json_each(CASE
        WHEN json_valid(sessions.metadata_json)
          AND json_type(sessions.metadata_json, '$.speaker_context.meetings') = 'array'
        THEN json_extract(sessions.metadata_json, '$.speaker_context.meetings')
        ELSE '[]'
      END) AS capture
    ), 0), (
      SELECT MAX(CAST(json_extract(word.value, '$.end_ms') AS INTEGER))
      FROM transcripts AS transcript, json_each(transcript.words_json) AS word
      WHERE transcript.session_id = sessions.id
        AND transcript.deleted_at IS NULL
        AND json_valid(transcript.words_json)
    ), 0) AS audio_ms
  FROM sessions
  WHERE folder_path = ? AND kind = 'lesson' AND deleted_at IS NULL
  ORDER BY COALESCE(NULLIF(started_at, ''), created_at) DESC
`;

/** Lessons of one course (a folder), newest first. */
export function useCourseLessons(folderPath: string | null | undefined) {
  const { data = [] } = useLiveQuery<CourseLessonRow, CourseLessonRow[]>({
    sql: COURSE_LESSONS_SQL,
    params: [folderPath ?? ""],
    enabled: Boolean(folderPath),
    mapRows: (rows) => rows,
  });
  return folderPath ? data : [];
}

export async function loadCourseLessons(
  folderPath: string,
): Promise<CourseLessonRow[]> {
  return liveQueryClient.execute<CourseLessonRow>(COURSE_LESSONS_SQL, [
    folderPath,
  ]);
}

type SheetRow = { session_id: string; body: string };

/** Every study sheet in a course, keyed by lesson id. */
export function useCourseSheets(folderPath: string | null | undefined) {
  const { data = EMPTY_SHEETS } = useLiveQuery<
    SheetRow,
    Map<string, LessonSheetDocument>
  >({
    sql: `
      SELECT document.session_id, document.body
      FROM session_documents AS document
      JOIN sessions AS session ON session.id = document.session_id
      WHERE session.folder_path = ? AND session.kind = 'lesson'
        AND session.deleted_at IS NULL
        AND document.kind = 'lesson_sheet' AND document.deleted_at IS NULL
    `,
    params: [folderPath ?? ""],
    enabled: Boolean(folderPath),
    mapRows: (rows) => {
      const sheets = new Map<string, LessonSheetDocument>();
      for (const row of rows) {
        try {
          const parsed = parseLessonSheetDocument(JSON.parse(row.body));
          if (parsed) sheets.set(row.session_id, parsed);
        } catch {
          // A sheet that can't be read is left out of the course view.
        }
      }
      return sheets;
    },
  });
  return folderPath ? data : EMPTY_SHEETS;
}

const EMPTY_SHEETS = new Map<string, LessonSheetDocument>();
