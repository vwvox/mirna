import { executeTransaction, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";

export function homeworkTodoId(sessionId: string, text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return `${sessionId}:homework:${(hash >>> 0).toString(36)}`;
}

/** Ids of the homework items already turned into to-dos of this note. */
export function useHomeworkTodoIds(sessionId: string): Set<string> {
  const { data = EMPTY } = useLiveQuery<{ id: string }, Set<string>>({
    sql: `
      SELECT id FROM action_items
      WHERE id LIKE ? AND deleted_at IS NULL
    `,
    params: [`${sessionId}:homework:%`],
    enabled: Boolean(sessionId),
    mapRows: (rows) => new Set(rows.map((row) => row.id)),
  });
  return data;
}

const EMPTY = new Set<string>();

function homeworkTodoStatement(
  sessionId: string,
  homework: { text: string; due: string },
  now: string,
) {
  const text = homework.due
    ? `${homework.text} (${homework.due})`
    : homework.text;
  return {
    sql: `
      INSERT INTO action_items (
        id, workspace_id, created_by, updated_by, session_id, source_type,
        source_id, source_order, status, text, body_json, created_at,
        updated_at, deleted_at
      ) SELECT ?, workspace_id, owner_user_id, owner_user_id, id,
        'session_raw_note', id,
        (SELECT COALESCE(MAX(source_order), -1) + 1 FROM action_items
          WHERE source_type = 'session_raw_note' AND source_id = ?),
        'todo', ?, ?, ?, ?, NULL
      FROM sessions WHERE id = ? AND deleted_at IS NULL
      ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at
    `,
    params: [
      homeworkTodoId(sessionId, homework.text),
      sessionId,
      text,
      JSON.stringify([
        { type: "paragraph", content: [{ type: "text", text }] },
      ]),
      now,
      now,
      sessionId,
    ],
  };
}

/**
 * Adds a homework item to the note's own to-dos, so it shows in My notes with the
 * other tasks. The due date the teacher gave stays in the text, as said.
 */
export function addHomeworkTodo(
  sessionId: string,
  homework: { text: string; due: string },
): Promise<void> {
  const now = new Date().toISOString();
  return enqueueDatabaseWrite(`lesson-homework:${sessionId}`, async () => {
    await executeTransaction([homeworkTodoStatement(sessionId, homework, now)]);
  });
}

/** Ticks homework off (or back on), adding it to the to-dos first if needed. */
export function setHomeworkDone(
  sessionId: string,
  homework: { text: string; due: string },
  done: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  return enqueueDatabaseWrite(`lesson-homework:${sessionId}`, async () => {
    await executeTransaction([
      homeworkTodoStatement(sessionId, homework, now),
      {
        sql: `
          UPDATE action_items
          SET status = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `,
        params: [
          done ? "done" : "todo",
          done ? now : null,
          now,
          homeworkTodoId(sessionId, homework.text),
        ],
      },
    ]);
  });
}

/** Status of each homework to-do of these lessons ("todo", "done"…), by id. */
export function useHomeworkStatuses(
  sessionIds: string[],
): ReadonlyMap<string, string> {
  const placeholders = sessionIds.map(() => "?").join(", ");
  const { data = NO_STATUSES } = useLiveQuery<
    { id: string; status: string },
    Map<string, string>
  >({
    sql: `
      SELECT id, status FROM action_items
      WHERE session_id IN (${placeholders || "''"})
        AND id LIKE '%:homework:%' AND deleted_at IS NULL
    `,
    params: sessionIds,
    enabled: sessionIds.length > 0,
    mapRows: (rows) => new Map(rows.map((row) => [row.id, row.status])),
  });
  return sessionIds.length > 0 ? data : NO_STATUSES;
}

const NO_STATUSES = new Map<string, string>();

export type CourseHomework = {
  sessionId: string;
  lessonTitle: string;
  text: string;
  due: string;
  done: boolean;
};

/** Every lesson's homework, newest lesson first, open items before finished ones. */
export function courseHomework(
  lessons: Array<{
    sessionId: string;
    title: string;
    homework: Array<{ text: string; due: string }>;
  }>,
  statuses: ReadonlyMap<string, string>,
): CourseHomework[] {
  const items = lessons.flatMap((lesson) =>
    lesson.homework.map((item) => ({
      sessionId: lesson.sessionId,
      lessonTitle: lesson.title,
      text: item.text,
      due: item.due,
      done:
        statuses.get(homeworkTodoId(lesson.sessionId, item.text)) === "done",
    })),
  );
  return [
    ...items.filter((item) => !item.done),
    ...items.filter((item) => item.done),
  ];
}
