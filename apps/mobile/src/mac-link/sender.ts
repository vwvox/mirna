// Sends recordings to the paired Mac and brings back what it made of them.
//
// Runs after a recording stops, when the app opens, every so often while it's
// open, and from the Android background job. Only on Wi-Fi or Ethernet: the
// Mac is on the local network, so mobile data could never reach it anyway.
import { File, Paths } from "expo-file-system";

import { defaultSummaryDocumentId } from "@anlg/utils/session";

import { execute, executeTransaction } from "@/db";
import { nowIso } from "@/lib/ids";

import { discoverMacs, isOnLocalNetwork } from "../../modules/mac-discovery";
import * as bridge from "./bridge";
import { LinkError, type RemoteStatus } from "./bridge";
import {
  type MacLinkStatus,
  parseMacLink,
  proseMirrorToMarkdown,
  wavDurationMs,
} from "./model";
import {
  loadIdentity,
  loadPairedMac,
  rememberWorkingHost,
  targetFor,
} from "./pairing";
import { attachmentIdFor, setMacLinkStatus } from "./status";

type PendingRow = {
  session_id: string;
  filename: string;
  size_bytes: number;
  mac_link: string | null;
  capture_started_at_ms: number | null;
  title: string;
  created_at: string;
};

const PENDING_SQL = `
SELECT
  attachment.session_id,
  attachment.filename,
  attachment.size_bytes,
  json_extract(attachment.metadata_json, '$.mac_link') AS mac_link,
  json_extract(attachment.metadata_json, '$.capture_started_at_ms') AS capture_started_at_ms,
  session.title,
  session.created_at
FROM session_attachments AS attachment
JOIN sessions AS session
  ON session.id = attachment.session_id AND session.deleted_at IS NULL
JOIN attachment_local_state AS local_state
  ON local_state.attachment_id = attachment.id AND local_state.availability = 'present'
WHERE attachment.source_type = 'session_audio'
  AND attachment.deleted_at IS NULL
  AND attachment.size_bytes > 0
  AND COALESCE(json_extract(attachment.metadata_json, '$.mac_link.state'), 'waiting') <> 'done'
ORDER BY attachment.created_at, attachment.id
LIMIT 50
`;

const NOTE_SQL = `
SELECT body, body_format FROM session_documents
WHERE session_id = ? AND kind = 'note' AND deleted_at IS NULL
ORDER BY CASE WHEN id = session_id THEN 0 ELSE 1 END, sort_order, id
LIMIT 1
`;

export type SendOutcome =
  | "nothing_to_send"
  | "not_paired"
  | "not_on_wifi"
  | "mac_unreachable"
  | "unpaired_by_mac"
  | "other_mac"
  | "done";

let running: Promise<SendOutcome> | null = null;
let again = false;

/** Sends what's waiting. Calls made while one is running share its result. */
export function sendRecordingsToMac(): Promise<SendOutcome> {
  if (running) {
    again = true;
    return running;
  }
  running = run()
    .catch((error: unknown) => {
      console.warn("[mac-link] send failed", error);
      return "mac_unreachable" as const;
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void sendRecordingsToMac();
      }
    });
  return running;
}

/** Whether any recording still needs the Mac (to send it or to hear back). */
export async function hasPendingRecordings(): Promise<boolean> {
  const rows = await execute<PendingRow>(PENDING_SQL, []);
  return rows.length > 0;
}

async function run(): Promise<SendOutcome> {
  const mac = await loadPairedMac();
  if (!mac) return "not_paired";
  const identity = await loadIdentity();
  if (!identity) return "not_paired";

  const pending = await execute<PendingRow>(PENDING_SQL, []);
  if (pending.length === 0) return "nothing_to_send";
  if (!isOnLocalNetwork()) return "not_on_wifi";

  let connection = { identity, mac: targetFor(mac, null) };
  const ids = pending.map((row) => row.session_id);

  let remote: RemoteStatus[];
  try {
    remote = (await bridge.statuses(connection, ids)).statuses;
  } catch (error) {
    if (!(error instanceof LinkError)) throw error;
    if (error.code === "not_paired") return "unpaired_by_mac";
    if (error.code !== "unreachable" && error.code !== "mac_mismatch") {
      throw error;
    }
    // The Mac may have a new address: look for it on the network.
    const found = (await discoverMacs(4000)).find(
      (candidate) => candidate.id === mac.mac_id,
    );
    if (!found) {
      return error.code === "mac_mismatch" ? "other_mac" : "mac_unreachable";
    }
    connection = { identity, mac: targetFor(mac, found) };
    try {
      const reply = await bridge.statuses(connection, ids);
      remote = reply.statuses;
      await rememberWorkingHost(reply.working_host, found.port);
    } catch (retryError) {
      if (retryError instanceof LinkError && retryError.code === "not_paired") {
        return "unpaired_by_mac";
      }
      return "mac_unreachable";
    }
  }

  const byId = new Map(remote.map((status) => [status.id, status]));
  for (const row of pending) {
    const status = byId.get(row.session_id);
    if (!status) continue;
    const local = parseMacLink(row.mac_link);
    try {
      await advance(connection, row, local, status);
    } catch (error) {
      if (error instanceof LinkError && error.code === "unreachable") {
        // Lost the Wi-Fi mid-way; the next run resumes where the Mac is.
        return "mac_unreachable";
      }
      console.warn("[mac-link] recording not sent", row.session_id, error);
    }
  }
  return "done";
}

type Connection = Parameters<typeof bridge.statuses>[0];

async function advance(
  connection: Connection,
  row: PendingRow,
  local: MacLinkStatus,
  status: RemoteStatus,
) {
  switch (status.state) {
    case "missing":
    case "receiving": {
      const reached = await upload(connection, row, status.received_bytes);
      await advance(connection, row, local, reached);
      return;
    }
    case "queued":
      return update(row.session_id, local, {
        state: "on_mac",
        mac_session_id: status.session_id,
      });
    case "processing":
      return update(row.session_id, local, {
        state: status.stage === "summarizing" ? "summarizing" : "transcribing",
        mac_session_id: status.session_id,
      });
    case "failed":
      return update(row.session_id, local, {
        state: "failed",
        error: status.error,
        mac_session_id: status.session_id,
      });
    case "done":
      return applyDone(row.session_id, status);
  }
}

async function update(
  sessionId: string,
  local: MacLinkStatus,
  next: MacLinkStatus,
) {
  if (
    local.state === next.state &&
    (local.error ?? null) === (next.error ?? null) &&
    (local.mac_session_id ?? null) === (next.mac_session_id ?? null)
  ) {
    return;
  }
  await setMacLinkStatus(sessionId, next);
}

function fileFor(row: PendingRow) {
  return new File(Paths.document, "sessions", row.session_id, row.filename);
}

async function upload(
  connection: Connection,
  row: PendingRow,
  from: number,
): Promise<RemoteStatus> {
  const file = fileFor(row);
  if (!file.exists) throw new Error("Recording file is missing");
  const total = file.size ?? row.size_bytes;
  let offset = from;

  await setMacLinkStatus(row.session_id, {
    state: "sending",
    sent_bytes: offset,
    total_bytes: total,
  });
  while (offset < total) {
    const sent = await bridge.send(connection, {
      recordingId: row.session_id,
      file: file.uri,
      offset,
      chunks: 2,
    });
    if (sent.received_bytes <= offset && sent.received_bytes < total) {
      throw new Error("The Mac did not accept more of the recording");
    }
    offset = sent.received_bytes;
    await setMacLinkStatus(row.session_id, {
      state: "sending",
      sent_bytes: offset,
      total_bytes: total,
    });
  }

  const reply = await bridge.complete(connection, {
    recordingId: row.session_id,
    file: file.uri,
    meta: {
      title: row.title.trim() || null,
      started_at: startedAt(row),
      duration_ms: wavDurationMs(row.filename, total),
      ext: extensionOf(row.filename),
      notes_md: await noteMarkdown(row.session_id),
    },
  });
  await rememberWorkingHost(reply.working_host);
  return reply.status;
}

async function applyDone(sessionId: string, status: RemoteStatus) {
  const now = nowIso();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const title = status.title?.trim();
  if (title) {
    statements.push({
      sql: `UPDATE sessions SET title = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND trim(COALESCE(title, '')) = ''`,
      params: [title, now, sessionId],
    });
  }
  const summary = status.summary_md?.trim();
  if (summary) {
    statements.push({
      sql: `INSERT INTO session_documents (id, workspace_id, session_id, kind, title, body_format, body, generation_metadata_json, created_at, updated_at)
        SELECT ?, workspace_id, id, 'summary', 'Summary', 'markdown', ?, ?, ?, ? FROM sessions
        WHERE id = ? AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM session_documents WHERE session_id = ? AND kind IN ('summary', 'template_output') AND deleted_at IS NULL)
        ON CONFLICT(id) DO NOTHING`,
      params: [
        defaultSummaryDocumentId(sessionId),
        summary,
        JSON.stringify({ provider: "mac" }),
        now,
        now,
        sessionId,
        sessionId,
      ],
    });
  }
  statements.push({
    sql: `UPDATE session_attachments
      SET metadata_json = json_set(COALESCE(metadata_json, '{}'),
        '$.transcript_status', 'complete',
        '$.mac_link', json(?))
      WHERE id = ? AND deleted_at IS NULL`,
    params: [
      JSON.stringify({
        state: "done",
        mac_session_id: status.session_id,
        updated_at: now,
      } satisfies MacLinkStatus),
      attachmentIdFor(sessionId),
    ],
  });
  await executeTransaction(statements);
}

function startedAt(row: PendingRow): string | null {
  const ms = Number(row.capture_started_at_ms);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  const created = new Date(row.created_at);
  return Number.isNaN(created.getTime()) ? null : created.toISOString();
}

function extensionOf(filename: string) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext === "mpeg" ? "mp3" : ext;
}

async function noteMarkdown(sessionId: string): Promise<string | null> {
  const [note] = await execute<{ body: string; body_format: string }>(
    NOTE_SQL,
    [sessionId],
  );
  if (!note?.body) return null;
  if (note.body_format === "markdown") return note.body.trim() || null;
  try {
    const text = proseMirrorToMarkdown(JSON.parse(note.body)).trim();
    return text || null;
  } catch {
    return null;
  }
}
