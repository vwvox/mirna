import { executeTransaction, useLiveQuery } from "~/db";

/**
 * A note's summary is outdated when its transcript was redone after the
 * summary was written. Transcribing again marks it; writing the summary again
 * (or editing it) is newer than the mark, so the notice goes away by itself.
 */
const markerId = (sessionId: string) => `summary_outdated:${sessionId}`;

export async function markSummaryOutdated(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await executeTransaction([
    {
      sql: `
        INSERT INTO app_settings (id, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
      params: [markerId(sessionId), JSON.stringify(now), now],
    },
  ]);
}

export async function clearSummaryOutdated(sessionId: string): Promise<void> {
  await executeTransaction([
    {
      sql: `DELETE FROM app_settings WHERE id = ?`,
      params: [markerId(sessionId)],
    },
  ]);
}

type SummaryOutdatedRow = {
  marked_at: string | null;
  summary_at: string | null;
};

export function isSummaryOutdated(row: SummaryOutdatedRow | null): boolean {
  if (!row?.marked_at) return false;
  return !row.summary_at || row.summary_at < row.marked_at;
}

const SUMMARY_OUTDATED_SQL = `
  SELECT
    json_extract(marker.value_json, '$') AS marked_at,
    (
      SELECT updated_at FROM session_documents
      WHERE id = ? AND deleted_at IS NULL
    ) AS summary_at
  FROM app_settings AS marker
  WHERE marker.id = ?
`;

export function useSummaryOutdated(
  sessionId: string,
  summaryId: string,
): boolean {
  const { data = false } = useLiveQuery<SummaryOutdatedRow, boolean>({
    sql: SUMMARY_OUTDATED_SQL,
    params: [summaryId, markerId(sessionId)],
    enabled: Boolean(sessionId && summaryId),
    mapRows: (rows) => isSummaryOutdated(rows[0] ?? null),
  });
  return data;
}
