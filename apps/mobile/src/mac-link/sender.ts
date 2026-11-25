// Sends recordings to the paired Mac and brings back what it made of them.
//
// Each run has a reason (see SendTrigger), which decides how much it does:
// - Sync now and pull to refresh do everything straight away.
// - Opening the app, or stopping a recording, sends what's waiting (when
//   sending is automatic) and fetches notes the Mac changed.
// - The 30-second check while the app is open, and Android's background job,
//   only follow recordings still on their way. They wait longer each time the
//   Mac doesn't answer, and the background job never looks for the Mac on a
//   Wi-Fi where it has never answered.
// Only on Wi-Fi or Ethernet, or when the Mac has joined this phone's hotspot:
// the Mac is on the local network, so mobile data could never reach it anyway.
import { File, Paths } from "expo-file-system";

import { defaultSummaryDocumentId } from "@anlg/utils/session";

import { isRecordingNow } from "@/audio/capture-lifecycle";
import { execute, executeTransaction } from "@/db";
import {
  diagnosticsFileUri,
  logDiagnostic,
  logDiagnosticError,
  readDiagnostics,
} from "@/lib/diagnostics";
import { nowIso } from "@/lib/ids";

import {
  currentNetworkKey,
  discoverMacs,
  hotspotSubnets,
  isOnLocalNetwork,
  probePort,
} from "../../modules/mac-discovery";
import * as bridge from "./bridge";
import { LinkError, type NoteJob, type RemoteStatus } from "./bridge";
import {
  hotspotCandidates,
  isBackingOff,
  isHomeNetwork,
  keepSyncedFields,
  type MacLinkStatus,
  needsMacContact,
  parseMacLink,
  proseMirrorToMarkdown,
  type SendTrigger,
  strongerTrigger,
  wavDurationMs,
} from "./model";
import { applyRemoteNote } from "./notes";
import {
  loadIdentity,
  loadPairedMac,
  type PairedMac,
  rememberWorkingHost,
  targetFor,
} from "./pairing";
import {
  clearBackoff,
  loadBackoff,
  loadDiagnosticsSent,
  loadIncludeMacNotes,
  loadKnownNetworks,
  loadNotesCursor,
  loadSendMode,
  noteMacUnreachable,
  recordLastSync,
  rememberMacNetwork,
  saveDiagnosticsSent,
  saveNotesCursor,
} from "./schedule";
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
  /** Waiting a while after the Mac didn't answer on this Wi-Fi. */
  | "backing_off"
  /** On a Wi-Fi where the Mac has never answered; not looking for it. */
  | "away"
  /** A recording is going; automatic syncs wait until it stops. */
  | "recording"
  | "done";

type Run = { trigger: SendTrigger; promise: Promise<SendOutcome> };
let current: Run | null = null;
let queued: Run | null = null;
const finishedListeners = new Set<() => void>();

/** Called after every run, for example to schedule or cancel the background job. */
export function onSendFinished(listener: () => void) {
  finishedListeners.add(listener);
  return () => finishedListeners.delete(listener);
}

/**
 * Syncs with the Mac. A call made while a run is going waits for one more
 * run afterwards, as thorough as the strongest reason asked for.
 */
export function sendRecordingsToMac(
  trigger: SendTrigger = "open",
): Promise<SendOutcome> {
  if (!current) return start(trigger);
  if (queued) {
    queued.trigger = strongerTrigger(queued.trigger, trigger);
    return queued.promise;
  }
  const next: Run = { trigger, promise: Promise.resolve("done") };
  next.promise = current.promise.then(() => {
    queued = null;
    return start(next.trigger);
  });
  queued = next;
  return next.promise;
}

function start(trigger: SendTrigger): Promise<SendOutcome> {
  const startedAt = Date.now();
  const promise = run(trigger)
    .catch((error: unknown) => {
      console.warn("[mac-link] sync failed", error);
      logDiagnosticError("mac_sync_failed", error, { trigger });
      return "mac_unreachable" as const;
    })
    .then((outcome) => {
      // Automatic runs that didn't try to reach the Mac aren't worth a line
      // each: they come every 30 s while something is waiting.
      const quiet =
        outcome === "nothing_to_send" ||
        outcome === "recording" ||
        ((trigger === "interval" || trigger === "background") &&
          (outcome === "not_on_wifi" ||
            outcome === "away" ||
            outcome === "backing_off"));
      if (!quiet) {
        logDiagnostic("mac_sync", {
          trigger,
          outcome,
          ms: Date.now() - startedAt,
        });
      }
      return outcome;
    })
    .finally(() => {
      current = null;
      for (const listener of finishedListeners) listener();
    });
  current = { trigger, promise };
  return promise;
}

/** Whether any recording still needs the Mac, so the background job should run. */
export async function needsBackgroundSync(): Promise<boolean> {
  if (!(await loadPairedMac())) return false;
  const mode = await loadSendMode();
  const rows = await execute<PendingRow>(PENDING_SQL, []);
  return rows.some((row) => needsMacContact(parseMacLink(row.mac_link), mode));
}

async function run(trigger: SendTrigger): Promise<SendOutcome> {
  const mac = await loadPairedMac();
  if (!mac) return "not_paired";
  const identity = await loadIdentity();
  if (!identity) return "not_paired";

  const userAsked = trigger === "user";
  // Keep a recording undisturbed; the save at the end triggers a sync anyway.
  if (!userAsked && isRecordingNow()) return "recording";
  const fresh = userAsked || trigger === "open";
  const mode = userAsked ? "auto" : await loadSendMode();
  const rows = await execute<PendingRow>(PENDING_SQL, []);
  const pending = rows.filter((row) => {
    const local = parseMacLink(row.mac_link);
    // Sync now also retries ones the Mac couldn't transcribe.
    return userAsked ? true : needsMacContact(local, mode);
  });
  if (pending.length === 0 && !fresh) return "nothing_to_send";
  // Android doesn't always say when the phone is a hotspot, so a tap tries
  // anyway; only automatic syncs stop here.
  const local = isOnLocalNetwork();
  if (!local && !userAsked) return "not_on_wifi";

  const network = currentNetworkKey();
  const home = isHomeNetwork(await loadKnownNetworks(), network);
  if (fresh) {
    await clearBackoff();
  } else if (isBackingOff(await loadBackoff(), network, Date.now())) {
    return "backing_off";
  }
  // Away from home, only a tap, or something waiting to go, makes the phone
  // look for the Mac; the background job never does.
  if (
    !home &&
    (trigger === "background" || (!userAsked && pending.length === 0))
  ) {
    return "away";
  }

  const reached = await reachMac(mac, identity, pending, local);
  if (reached.outcome) {
    if (reached.outcome === "mac_unreachable" && !userAsked) {
      await noteMacUnreachable(network);
    }
    return !local && reached.outcome === "mac_unreachable"
      ? "not_on_wifi"
      : reached.outcome;
  }
  const { connection, remote } = reached;
  await rememberMacNetwork(network);
  await clearBackoff();

  const byId = new Map(remote.map((status) => [status.id, status]));
  let finished = 0;
  for (const row of pending) {
    const status = byId.get(row.session_id);
    if (!status) continue;
    try {
      if (
        await advance(connection, row, parseMacLink(row.mac_link), status, mode)
      ) {
        finished += 1;
      }
    } catch (error) {
      if (error instanceof LinkError && error.code === "unreachable") {
        // Lost the Wi-Fi mid-way; the next run resumes where the Mac is.
        return "mac_unreachable";
      }
      console.warn("[mac-link] recording not sent", row.session_id, error);
      logDiagnosticError("mac_send_failed", error, {});
    }
  }

  let pulled: PullResult = { updated: 0, failed: 0, error: null };
  // A note the Mac just finished (or worked on again) comes back right away.
  if (fresh || finished > 0) {
    try {
      pulled = await pullNoteChanges(connection, mac);
    } catch (error) {
      // An older Mac app doesn't have note changes yet; that's fine.
      console.warn("[mac-link] could not fetch note changes", error);
      logDiagnosticError("mac_notes_fetch_failed", error, {}, "warning");
    }
    if (pulled.updated > 0 || pulled.failed > 0) {
      logDiagnostic("mac_notes_fetched", {
        updated: pulled.updated,
        failed: pulled.failed,
      });
    }
    await sendDiagnostics(connection);
  }
  await recordLastSync({
    at: nowIso(),
    notes_updated: pulled.updated,
    notes_failed: pulled.failed,
    error: pulled.error,
  });
  return "done";
}

/**
 * Asks the Mac to try a recording it couldn't transcribe again (from the
 * note's "Try again"), then syncs so the phone follows along.
 */
export async function retryRecordingOnMac(
  sessionId: string,
): Promise<SendOutcome> {
  const mac = await loadPairedMac();
  const identity = await loadIdentity();
  if (!mac || !identity) return "not_paired";
  // Tried even when the phone doesn't look like it's on Wi-Fi (see run()).
  try {
    await bridge.retry({ identity, mac: targetFor(mac, null) }, sessionId);
  } catch (error) {
    if (error instanceof LinkError && error.code === "not_paired") {
      return "unpaired_by_mac";
    }
    if (error instanceof LinkError && error.code === "unreachable") {
      return isOnLocalNetwork() ? "mac_unreachable" : "not_on_wifi";
    }
    throw error;
  }
  await setMacLinkStatus(sessionId, { state: "on_mac" });
  return sendRecordingsToMac("user");
}

export type NoteJobOutcome =
  | "queued"
  /** The Mac hadn't started on it yet; it cut its waiting copy instead. */
  | "trimmed_on_mac"
  /** The Mac dropped what had arrived; the phone sends the shorter file. */
  | "send_again"
  | "busy"
  | "not_ready"
  | "no_audio"
  | "not_paired"
  | "unpaired_by_mac"
  | "not_on_wifi"
  | "mac_unreachable"
  | "other_mac"
  /** The Mac's Mirna is older than this request. */
  | "mac_too_old";

/**
 * Asks the Mac to transcribe a note's recording again, or to cut its end.
 * The Mac has to be reachable now; the phone then follows along as it does
 * for a new recording.
 */
export async function requestNoteJob(
  sessionId: string,
  job: NoteJob,
): Promise<NoteJobOutcome> {
  const mac = await loadPairedMac();
  const identity = await loadIdentity();
  if (!mac || !identity) return "not_paired";
  const reached = await reachMac(mac, identity, [], isOnLocalNetwork());
  if (reached.outcome) {
    const outcome =
      reached.outcome === "unpaired_by_mac" || reached.outcome === "other_mac"
        ? reached.outcome
        : isOnLocalNetwork()
          ? "mac_unreachable"
          : "not_on_wifi";
    logDiagnostic(
      "note_job_unreachable",
      { job: job.type, outcome },
      "warning",
    );
    return outcome;
  }
  let status: RemoteStatus;
  try {
    status = (await bridge.noteJob(reached.connection, sessionId, job)).status;
  } catch (error) {
    const reason = bridge.refusalReason(error);
    logDiagnosticError("note_job_refused", error, { job: job.type }, "warning");
    if (reason === "busy" || reason === "not_ready" || reason === "no_audio") {
      return reason;
    }
    if (bridge.isUnknownRequest(error)) return "mac_too_old";
    if (error instanceof LinkError && error.code === "unreachable") {
      return "mac_unreachable";
    }
    throw error;
  }
  logDiagnostic("note_job_requested", {
    job: job.type,
    state: status.state,
    queued_job: status.job?.type ?? null,
  });
  if (status.state === "missing") {
    await setMacLinkStatus(sessionId, { state: "waiting", job: null });
    return "send_again";
  }
  if (status.job) {
    await setMacLinkStatus(sessionId, {
      state: "on_mac",
      job: status.job.type,
      mac_session_id: status.session_id,
    });
  }
  void sendRecordingsToMac("user");
  return status.job
    ? "queued"
    : job.type === "trim"
      ? "trimmed_on_mac"
      : "queued";
}

/** Sends the problem log to the Mac when it has changed since last time. */
async function sendDiagnostics(connection: Connection) {
  try {
    const log = readDiagnostics();
    if (!log) return;
    const marker = `${log.length}:${log.slice(-120)}`;
    if ((await loadDiagnosticsSent()) === marker) return;
    await bridge.uploadDiagnostics(connection, diagnosticsFileUri());
    await saveDiagnosticsSent(marker);
  } catch (error) {
    // An older Mac app doesn't take logs; nothing else depends on this.
    console.warn("[mac-link] could not send the log", error);
  }
}

type Connection = Parameters<typeof bridge.statuses>[0];

async function reachMac(
  mac: PairedMac,
  identity: Connection["identity"],
  pending: PendingRow[],
  /** On Wi-Fi or a hotspot; Bonjour can't find anything otherwise. */
  local: boolean,
): Promise<
  | { outcome: SendOutcome }
  | { outcome?: undefined; connection: Connection; remote: RemoteStatus[] }
> {
  const ids = pending.map((row) => row.session_id);
  let connection: Connection = { identity, mac: targetFor(mac, null) };
  try {
    const reply = await bridge.statuses(connection, ids);
    await rememberWorkingHost(reply.working_host);
    return { connection, remote: reply.statuses };
  } catch (error) {
    if (!(error instanceof LinkError)) throw error;
    if (error.code === "not_paired") return { outcome: "unpaired_by_mac" };
    if (error.code !== "unreachable" && error.code !== "mac_mismatch") {
      throw error;
    }
    // The Mac may have a new address: look for it on the network, and on this
    // phone's hotspot if it's on (Bonjour doesn't always reach devices there).
    const [discovered, onHotspot] = await Promise.all([
      local ? discoverMacs(4000) : Promise.resolve([]),
      findOnHotspot(mac.port),
    ]);
    const found =
      discovered.find((candidate) => candidate.id === mac.mac_id) ??
      (onHotspot.length > 0 ? { hosts: onHotspot, port: mac.port } : null);
    if (!found) {
      return {
        outcome:
          error.code === "mac_mismatch" ? "other_mac" : "mac_unreachable",
      };
    }
    connection = { identity, mac: targetFor(mac, found) };
    try {
      const reply = await bridge.statuses(connection, ids);
      await rememberWorkingHost(reply.working_host, found.port);
      return { connection, remote: reply.statuses };
    } catch (retryError) {
      if (retryError instanceof LinkError && retryError.code === "not_paired") {
        return { outcome: "unpaired_by_mac" };
      }
      return { outcome: "mac_unreachable" };
    }
  }
}

/**
 * Devices on this phone's hotspot that accept connections on Mirna's port.
 * The connection that follows checks the Mac's certificate, so another
 * device answering here is never mistaken for the paired Mac.
 */
async function findOnHotspot(port: number): Promise<string[]> {
  const candidates = hotspotCandidates(hotspotSubnets());
  if (candidates.length === 0) return [];
  return probePort(candidates, port);
}

type PullResult = { updated: number; failed: number; error: string | null };

/**
 * Takes in the notes that changed on the Mac. If one can't be taken in, the
 * phone keeps its place so the whole batch is tried again next time (notes
 * already taken in are skipped then, as their text hasn't changed).
 */
async function pullNoteChanges(
  connection: Connection,
  mac: PairedMac,
): Promise<PullResult> {
  const includeMacNotes = await loadIncludeMacNotes();
  let cursor = await loadNotesCursor(mac.mac_id, includeMacNotes);
  const result: PullResult = { updated: 0, failed: 0, error: null };
  for (let page = 0; page < 20; page += 1) {
    const reply = await bridge.noteChanges(connection, cursor, includeMacNotes);
    for (const note of reply.notes) {
      try {
        if (await applyRemoteNote(note)) result.updated += 1;
      } catch (error) {
        result.failed += 1;
        result.error = error instanceof Error ? error.message : String(error);
        console.warn("[mac-link] note not updated", note.session_id, error);
      }
    }
    if (result.failed > 0) break;
    cursor = reply.cursor;
    await saveNotesCursor(mac.mac_id, cursor, includeMacNotes);
    if (!reply.more) break;
  }
  return result;
}

/** Moves a recording along; returns whether the Mac just finished it. */
async function advance(
  connection: Connection,
  row: PendingRow,
  local: MacLinkStatus,
  status: RemoteStatus,
  mode: "auto" | "manual",
): Promise<boolean> {
  const job = status.job?.type ?? null;
  switch (status.state) {
    case "missing":
    case "receiving": {
      // Sending only when it's automatic, or when someone tapped Sync now.
      if (mode !== "auto") return false;
      const reached = await upload(connection, row, status.received_bytes);
      return advance(connection, row, local, reached, mode);
    }
    case "queued":
      await update(row.session_id, local, {
        state: "on_mac",
        mac_session_id: status.session_id,
        job,
      });
      return false;
    case "processing":
      await update(row.session_id, local, {
        state: status.stage === "summarizing" ? "summarizing" : "transcribing",
        mac_session_id: status.session_id,
        job,
      });
      return false;
    case "failed":
      await update(row.session_id, local, {
        state: "failed",
        error: status.error,
        mac_session_id: status.session_id,
        job,
      });
      return false;
    case "done":
      await applyDone(row.session_id, local, status);
      return true;
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
    (local.mac_session_id ?? null) === (next.mac_session_id ?? null) &&
    (local.job ?? null) === (next.job ?? null)
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
  const sendStartedAt = Date.now();
  logDiagnostic("recording_send_started", { from, bytes: total });

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
  logDiagnostic("recording_sent", {
    bytes: total,
    ms: Date.now() - sendStartedAt,
    state: reply.status.state,
  });
  return reply.status;
}

async function applyDone(
  sessionId: string,
  local: MacLinkStatus,
  status: RemoteStatus,
) {
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
        ...keepSyncedFields(local),
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
