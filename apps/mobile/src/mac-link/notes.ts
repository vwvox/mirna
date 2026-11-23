// Takes in a note's text as the Mac has it now: its title, summary and
// transcripts (never audio). Runs when the app opens, on pull to refresh and
// on Sync now, so a recording added to the note on the Mac, or a summary
// written again there, shows up on the phone too. With "Notes made on the
// Mac" on, meetings recorded on the Mac arrive the same way as text-only notes.
import { defaultSummaryDocumentId } from "@anlg/utils/session";

import { createSession } from "@/data/session";
import { execute, executeTransaction } from "@/db";
import { nowIso } from "@/lib/ids";

import {
  hashText,
  type MacLinkStatus,
  macNoteSessionId,
  macOnlyRecordings,
  parseMacLink,
  type RemoteNote,
} from "./model";
import { attachmentIdFor } from "./status";

type Statement = { sql: string; params: unknown[] };
type Synced = NonNullable<MacLinkStatus["synced"]>;

/** Returns whether anything on the phone changed. */
export async function applyRemoteNote(note: RemoteNote): Promise<boolean> {
  return note.recording_id
    ? applyPhoneNote(note, note.recording_id)
    : applyMacNote(note);
}

// --- Notes that began as recordings on this phone ---------------------------

type LocalPhoneNote = {
  mac_link: string | null;
  capture_started_at_ms: number | null;
};

async function applyPhoneNote(note: RemoteNote, sessionId: string) {
  const [local] = await execute<LocalPhoneNote>(
    `SELECT json_extract(attachment.metadata_json, '$.mac_link') AS mac_link,
      json_extract(attachment.metadata_json, '$.capture_started_at_ms') AS capture_started_at_ms
    FROM sessions AS session
    JOIN session_attachments AS attachment
      ON attachment.id = ? AND attachment.deleted_at IS NULL
    WHERE session.id = ? AND session.deleted_at IS NULL`,
    [attachmentIdFor(sessionId), sessionId],
  );
  // Deleted on the phone: leave it deleted.
  if (!local) return false;

  const status = parseMacLink(local.mac_link);
  const now = nowIso();
  const content = contentStatements(sessionId, note, status.synced, now);

  const startedAt = Number(local.capture_started_at_ms);
  const next: MacLinkStatus = {
    ...status,
    mac_session_id: note.session_id,
    mac_recordings: macOnlyRecordings(
      note.transcripts,
      Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    ),
    updated_on_mac_at: content.changedOnMac
      ? now
      : (status.updated_on_mac_at ?? null),
    synced: content.synced,
  };
  const statements = [...content.statements];
  statements.push({
    sql: content.hasTranscripts
      ? `UPDATE session_attachments
          SET metadata_json = json_set(COALESCE(metadata_json, '{}'),
            '$.mac_link', json(?), '$.transcript_status', 'complete')
          WHERE id = ? AND deleted_at IS NULL`
      : `UPDATE session_attachments
          SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.mac_link', json(?))
          WHERE id = ? AND deleted_at IS NULL`,
    params: [JSON.stringify(next), attachmentIdFor(sessionId)],
  });
  await executeTransaction(statements);
  return content.statements.length > 0;
}

// --- Notes recorded on the Mac (text only) ----------------------------------

type MacNoteState = {
  /** The Mac's id for the note. */
  session_id: string;
  synced?: Synced;
};

async function applyMacNote(note: RemoteNote) {
  const sessionId = macNoteSessionId(note.session_id);
  const [existing] = await execute<{
    deleted_at: string | null;
    mac_note: string | null;
  }>(
    `SELECT deleted_at, json_extract(metadata_json, '$.mac_note') AS mac_note
    FROM sessions WHERE id = ?`,
    [sessionId],
  );
  // Deleted on the phone: don't bring it back.
  if (existing?.deleted_at) return false;
  if (!existing) {
    await createSession({
      sessionId,
      title: note.title.trim(),
      createdAt: note.created_at ?? undefined,
      trackCreated: false,
    });
  }

  let state: MacNoteState = { session_id: note.session_id };
  try {
    if (existing?.mac_note) state = JSON.parse(existing.mac_note) as MacNoteState;
  } catch {
    // Start the sync record over.
  }
  const now = nowIso();
  const content = contentStatements(sessionId, note, state.synced, now);
  const next: MacNoteState = {
    session_id: note.session_id,
    synced: content.synced,
  };
  await executeTransaction([
    ...content.statements,
    {
      sql: `UPDATE sessions
        SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.mac_note', json(?))
        WHERE id = ? AND deleted_at IS NULL`,
      params: [JSON.stringify(next), sessionId],
    },
  ]);
  return !existing || content.statements.length > 0;
}

// --- Shared: title, summary and transcripts ---------------------------------

function contentStatements(
  sessionId: string,
  note: RemoteNote,
  synced: Synced | undefined,
  now: string,
) {
  const previous = synced ?? {};
  // The first copy only fills the note in; later ones are changes made on the Mac.
  const firstCopy = !synced;
  const statements: Statement[] = [];
  let changedOnMac = false;

  const title = note.title.trim();
  if (title && title !== (previous.title ?? null)) {
    // A title typed on the phone wins; an empty one or the Mac's last one is replaced.
    statements.push({
      sql: `UPDATE sessions SET title = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
          AND (trim(COALESCE(title, '')) = '' OR title = ?)`,
      params: [title, now, sessionId, previous.title ?? ""],
    });
    if (!firstCopy) changedOnMac = true;
  }

  const summary = note.summary_md?.trim() || null;
  const summaryHash = summary ? hashText(summary) : null;
  if (summary && summaryHash !== (previous.summary_hash ?? null)) {
    const documentId = defaultSummaryDocumentId(sessionId);
    statements.push(
      {
        sql: `UPDATE session_documents
          SET body = ?, body_format = 'markdown', updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        params: [summary, now, documentId],
      },
      {
        sql: `INSERT INTO session_documents (id, workspace_id, session_id, kind, title, body_format, body, generation_metadata_json, created_at, updated_at)
          SELECT ?, workspace_id, id, 'summary', 'Summary', 'markdown', ?, ?, ?, ? FROM sessions
          WHERE id = ? AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM session_documents WHERE session_id = ? AND kind IN ('summary', 'template_output') AND deleted_at IS NULL)
          ON CONFLICT(id) DO NOTHING`,
        params: [
          documentId,
          summary,
          JSON.stringify({ provider: "mac" }),
          now,
          now,
          sessionId,
          sessionId,
        ],
      },
    );
    if (!firstCopy) changedOnMac = true;
  }

  const transcriptsHash =
    note.transcripts.length > 0
      ? hashText(JSON.stringify(note.transcripts))
      : null;
  if (
    transcriptsHash &&
    transcriptsHash !== (previous.transcripts_hash ?? null)
  ) {
    for (const transcript of note.transcripts) {
      statements.push({
        sql: `INSERT INTO transcripts (id, workspace_id, owner_user_id, session_id, source, provider, started_at_ms, ended_at_ms, memo, words_json, speaker_hints_json, created_at, updated_at)
          SELECT ?, workspace_id, owner_user_id, id, 'mac', 'mac', ?, ?, ?, ?, ?, ?, ? FROM sessions
          WHERE id = ? AND deleted_at IS NULL
          ON CONFLICT(id) DO UPDATE SET
            session_id = excluded.session_id,
            started_at_ms = excluded.started_at_ms,
            ended_at_ms = excluded.ended_at_ms,
            memo = excluded.memo,
            words_json = excluded.words_json,
            speaker_hints_json = excluded.speaker_hints_json,
            updated_at = excluded.updated_at,
            deleted_at = NULL`,
        params: [
          transcript.id,
          transcript.started_at_ms,
          transcript.ended_at_ms,
          transcript.memo,
          transcript.words_json,
          transcript.speaker_hints_json,
          now,
          now,
          sessionId,
        ],
      });
    }
    // The Mac's transcripts replace the phone's live preview and older Mac copies.
    const ids = note.transcripts.map((transcript) => transcript.id);
    statements.push({
      sql: `UPDATE transcripts SET deleted_at = ?, updated_at = ?
        WHERE session_id = ? AND deleted_at IS NULL
          AND id NOT IN (${ids.map(() => "?").join(", ")})`,
      params: [now, now, sessionId, ...ids],
    });
    if (!firstCopy) changedOnMac = true;
  }

  return {
    statements,
    changedOnMac,
    hasTranscripts: transcriptsHash !== null,
    synced: {
      title: title || previous.title || null,
      summary_hash: summaryHash ?? previous.summary_hash ?? null,
      transcripts_hash: transcriptsHash ?? previous.transcripts_hash ?? null,
    } satisfies Synced,
  };
}
