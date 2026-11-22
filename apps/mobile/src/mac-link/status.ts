// Where each recording is on its way to the Mac. Stored as `mac_link` inside
// the audio attachment's metadata_json, so no mobile-only columns are needed.
import { executeTransaction, useLiveQuery } from "@/db";
import { nowIso } from "@/lib/ids";

import { type MacLinkStatus, parseMacLink } from "./model";

export {
  describeMacLink,
  type MacLinkState,
  type MacLinkStatus,
  parseMacLink,
} from "./model";

export function attachmentIdFor(sessionId: string) {
  return `session-audio:${sessionId}`;
}

export async function setMacLinkStatus(
  sessionId: string,
  status: MacLinkStatus,
) {
  await executeTransaction([
    {
      sql: `UPDATE session_attachments
        SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.mac_link', json(?))
        WHERE id = ? AND deleted_at IS NULL`,
      params: [
        JSON.stringify({ ...status, updated_at: nowIso() }),
        attachmentIdFor(sessionId),
      ],
    },
  ]);
}

const SESSION_MAC_LINK_SQL = `
SELECT json_extract(attachment.metadata_json, '$.mac_link') AS mac_link
FROM session_attachments AS attachment
WHERE attachment.session_id = ?
  AND attachment.source_type = 'session_audio'
  AND attachment.deleted_at IS NULL
LIMIT 1
`;

/** Null when the note has no recording. */
export function useMacLinkStatus(sessionId: string): MacLinkStatus | null {
  const { data } = useLiveQuery<
    { mac_link: string | null },
    MacLinkStatus | null
  >({
    sql: SESSION_MAC_LINK_SQL,
    params: [sessionId],
    mapRows: (rows) => (rows[0] ? parseMacLink(rows[0].mac_link) : null),
  });
  return data ?? null;
}

const ALL_MAC_LINK_SQL = `
SELECT attachment.session_id, json_extract(attachment.metadata_json, '$.mac_link') AS mac_link
FROM session_attachments AS attachment
WHERE attachment.source_type = 'session_audio'
  AND attachment.deleted_at IS NULL
`;

/** Status of every recording, keyed by session id (for the notes list). */
export function useMacLinkStatuses(): Map<string, MacLinkStatus> {
  const { data } = useLiveQuery<
    { session_id: string; mac_link: string | null },
    Map<string, MacLinkStatus>
  >({
    sql: ALL_MAC_LINK_SQL,
    params: [],
    mapRows: (rows) =>
      new Map(rows.map((row) => [row.session_id, parseMacLink(row.mac_link)])),
  });
  return data ?? new Map();
}
