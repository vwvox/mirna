import { useLiveQuery } from "~/db";

type Row = { id: string; title: string };

/** The lesson of the same course that came right before this one. */
export function usePreviousLesson(
  sessionId: string,
  folderPath: string,
): Row | null {
  const { data = null } = useLiveQuery<Row, Row | null>({
    sql: `
      SELECT other.id, other.title
      FROM sessions AS other
      JOIN sessions AS current ON current.id = ?
      WHERE other.folder_path = ? AND other.kind = 'lesson'
        AND other.id <> current.id AND other.deleted_at IS NULL
        AND COALESCE(NULLIF(other.started_at, ''), other.created_at)
          < COALESCE(NULLIF(current.started_at, ''), current.created_at)
      ORDER BY COALESCE(NULLIF(other.started_at, ''), other.created_at) DESC
      LIMIT 1
    `,
    params: [sessionId, folderPath],
    enabled: Boolean(sessionId && folderPath),
    mapRows: (rows) => rows[0] ?? null,
  });
  return folderPath ? data : null;
}
