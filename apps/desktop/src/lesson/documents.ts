import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";

/**
 * Lesson data lives in session_documents under kinds of its own, so the summary tabs,
 * search and sync code that filter by kind never see it, and no migration is needed.
 */
export type LessonDocumentKind =
  | "lesson_marks"
  | "lesson_sheet"
  | "lesson_practice"
  | "lesson_fixes"
  | "lesson_review";

type BodyRow = { body: string; source_hash: string };

const SELECT_SQL = `
  SELECT body, source_hash
  FROM session_documents
  WHERE id = ? AND kind = ? AND deleted_at IS NULL
  LIMIT 1
`;

export function lessonDocumentId(sessionId: string, kind: LessonDocumentKind) {
  return `${sessionId}:${kind}`;
}

function parseBody<T>(body: string, parse: (raw: unknown) => T | null) {
  try {
    return parse(JSON.parse(body));
  } catch {
    return null;
  }
}

export function useLessonDocument<T>(
  sessionId: string | null | undefined,
  kind: LessonDocumentKind,
  parse: (raw: unknown) => T | null,
): T | null {
  return useLessonDocumentQuery(sessionId, kind, parse).data;
}

/** The document, and whether it is still loading: null alone can't tell. */
export function useLessonDocumentQuery<T>(
  sessionId: string | null | undefined,
  kind: LessonDocumentKind,
  parse: (raw: unknown) => T | null,
): { data: T | null; isLoading: boolean } {
  const { data = null, isLoading } = useLiveQuery<BodyRow, T | null>({
    sql: SELECT_SQL,
    params: [lessonDocumentId(sessionId ?? "", kind), kind],
    enabled: Boolean(sessionId),
    mapRows: (rows) => (rows[0] ? parseBody(rows[0].body, parse) : null),
  });
  return sessionId ? { data, isLoading } : { data: null, isLoading: false };
}

export async function loadLessonDocument<T>(
  sessionId: string,
  kind: LessonDocumentKind,
  parse: (raw: unknown) => T | null,
): Promise<T | null> {
  const rows = await liveQueryClient.execute<BodyRow>(SELECT_SQL, [
    lessonDocumentId(sessionId, kind),
    kind,
  ]);
  return rows[0] ? parseBody(rows[0].body, parse) : null;
}

export function buildLessonDocumentUpsert(
  sessionId: string,
  kind: LessonDocumentKind,
  body: unknown,
  sourceHash: string,
  now: string,
) {
  return {
    sql: `
      INSERT INTO session_documents (
        id, workspace_id, session_id, kind, template_id, title,
        body_format, body, source_hash, generation_metadata_json,
        sort_order, created_by, updated_by, created_at, updated_at,
        deleted_at
      )
      SELECT ?, session.workspace_id, session.id, ?, '', '', 'json', ?, ?,
        '{}', 0, session.owner_user_id, session.owner_user_id, ?, ?, NULL
      FROM sessions AS session
      WHERE session.id = ? AND session.deleted_at IS NULL
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        source_hash = excluded.source_hash,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `,
    params: [
      lessonDocumentId(sessionId, kind),
      kind,
      JSON.stringify(body),
      sourceHash,
      now,
      now,
      sessionId,
    ],
  };
}

export function writeLessonDocument(
  sessionId: string,
  kind: LessonDocumentKind,
  body: unknown,
  sourceHash = "",
): Promise<void> {
  const key = `lesson:${lessonDocumentId(sessionId, kind)}`;
  return enqueueDatabaseWrite(key, async () => {
    await executeTransaction([
      buildLessonDocumentUpsert(
        sessionId,
        kind,
        body,
        sourceHash,
        new Date().toISOString(),
      ),
    ]);
  });
}

/** Read, change and write one document, one change at a time, so none is lost. */
export function updateLessonDocument<T>(
  sessionId: string,
  kind: LessonDocumentKind,
  parse: (raw: unknown) => T | null,
  empty: () => T,
  update: (current: T) => T,
): Promise<T> {
  const key = `lesson:${lessonDocumentId(sessionId, kind)}`;
  return enqueueDatabaseWrite(key, async () => {
    const current =
      (await loadLessonDocument(sessionId, kind, parse)) ?? empty();
    const next = update(current);
    await executeTransaction([
      buildLessonDocumentUpsert(
        sessionId,
        kind,
        next,
        "",
        new Date().toISOString(),
      ),
    ]);
    return next;
  });
}
