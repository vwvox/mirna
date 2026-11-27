// Typed wrappers around the Rust bridge's phone-link calls. Everything that
// touches the network or crypto happens in Rust (crates/phone-link): mutual
// TLS pinned to each side's certificate, chunked upload, checksums.
import {
  phoneLinkComplete,
  phoneLinkDownloadClip,
  phoneLinkFileSha256,
  phoneLinkInfo,
  phoneLinkNewIdentity,
  phoneLinkNoteChanges,
  phoneLinkNoteJob,
  phoneLinkPair,
  phoneLinkParseOffer,
  phoneLinkRetry,
  phoneLinkSend,
  phoneLinkSendReviews,
  phoneLinkStatuses,
  phoneLinkTrimWav,
  phoneLinkUploadDiagnostics,
} from "@anlg/mobile-bridge";

import type { CourseInfo, LessonTag, RemoteNote } from "./model";

export type PhoneIdentity = {
  cert_pem: string;
  key_pem: string;
  fingerprint: string;
};

export type PairingOffer = {
  mac_id: string;
  mac_name: string;
  addresses: string[];
  port: number;
  fingerprint: string;
  code: string;
};

export type MacTarget = {
  hosts: string[];
  port: number;
  fingerprint: string;
};

export type RemoteState =
  | "missing"
  | "receiving"
  | "queued"
  | "processing"
  | "done"
  | "failed";

/** Work on a note the phone can ask the Mac for. */
export type NoteJob =
  | {
      type: "retranscribe";
      engine: "auto" | "parakeet" | "qwen3";
      update_summary: boolean;
    }
  | { type: "trim"; keep_ms: number; update_summary: boolean }
  /**
   * More was recorded on the phone: the Mac drops its copy, takes the longer
   * file and makes the note again from it.
   */
  | { type: "extend"; update_summary: boolean }
  /** Make the note a lesson with these settings, or a normal note with none. */
  | { type: "set_lesson"; lesson: LessonTag | null };

export type RemoteStatus = {
  id: string;
  state: RemoteState;
  received_bytes: number;
  stage: string | null;
  session_id: string | null;
  title: string | null;
  summary_md: string | null;
  error: string | null;
  job?: NoteJob | null;
};

export type RecordingMeta = {
  title: string | null;
  started_at: string | null;
  duration_ms: number | null;
  ext: string;
  notes_md: string | null;
  /** Set when the recording is a lesson: the Mac files it and writes its sheet. */
  lesson?: LessonTag | null;
};

export type LinkErrorCode =
  | "unreachable"
  | "mac_mismatch"
  | "not_paired"
  | "pairing_rejected"
  | "invalid_offer"
  | "already_received"
  | "io"
  | "other";

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const KNOWN_CODES = new Set<LinkErrorCode>([
  "unreachable",
  "mac_mismatch",
  "not_paired",
  "pairing_rejected",
  "invalid_offer",
  "already_received",
  "io",
]);

function toLinkError(error: unknown): LinkError {
  if (error instanceof LinkError) return error;
  const inner = (error as { inner?: { code?: unknown; message?: unknown } })
    ?.inner;
  const raw =
    typeof inner?.code === "string"
      ? inner.code
      : /^(\w+):/.exec(error instanceof Error ? error.message : "")?.[1];
  const code = KNOWN_CODES.has(raw as LinkErrorCode)
    ? (raw as LinkErrorCode)
    : "other";
  const message =
    typeof inner?.message === "string"
      ? inner.message
      : error instanceof Error
        ? error.message
        : String(error);
  return new LinkError(code, message);
}

async function call<T>(run: () => Promise<string> | string): Promise<T> {
  try {
    return JSON.parse(await run()) as T;
  } catch (error) {
    throw toLinkError(error);
  }
}

export function newIdentity(): Promise<PhoneIdentity> {
  return call(() => phoneLinkNewIdentity());
}

export function parseOffer(text: string): Promise<PairingOffer> {
  return call(() => phoneLinkParseOffer(text));
}

export function pair(input: {
  identity: PhoneIdentity;
  offer: PairingOffer;
  phoneName: string;
}): Promise<{ mac_id: string; mac_name: string; working_host: string | null }> {
  return call(() =>
    phoneLinkPair(
      JSON.stringify({
        identity: input.identity,
        offer: input.offer,
        phone_name: input.phoneName,
      }),
    ),
  );
}

type Connection = { identity: PhoneIdentity; mac: MacTarget };

export function info(connection: Connection): Promise<{
  mac_id: string;
  mac_name: string;
  paired: boolean;
  working_host: string | null;
}> {
  return call(() => phoneLinkInfo(JSON.stringify(connection)));
}

export function statuses(
  connection: Connection,
  ids: string[],
): Promise<{ statuses: RemoteStatus[]; working_host: string | null }> {
  return call(() => phoneLinkStatuses(JSON.stringify({ ...connection, ids })));
}

export function send(
  connection: Connection,
  input: { recordingId: string; file: string; offset: number; chunks: number },
): Promise<{
  received_bytes: number;
  total_bytes: number;
  working_host: string | null;
}> {
  return call(() =>
    phoneLinkSend(
      JSON.stringify({
        ...connection,
        recording_id: input.recordingId,
        file: input.file,
        offset: input.offset,
        chunks: input.chunks,
      }),
    ),
  );
}

/** Asks the Mac to try a recording it couldn't transcribe again. */
export function retry(
  connection: Connection,
  recordingId: string,
): Promise<{ status: RemoteStatus; working_host: string | null }> {
  return call(() =>
    phoneLinkRetry(
      JSON.stringify({ ...connection, recording_id: recordingId }),
    ),
  );
}

/** Asks the Mac to transcribe a recording again or cut its end. */
export function noteJob(
  connection: Connection,
  recordingId: string,
  job: NoteJob,
): Promise<{ status: RemoteStatus; working_host: string | null }> {
  return call(() =>
    phoneLinkNoteJob(
      JSON.stringify({ ...connection, recording_id: recordingId, job }),
    ),
  );
}

/** Sends this phone's problem log file to the Mac. */
export function uploadDiagnostics(
  connection: Connection,
  file: string,
): Promise<{ working_host: string | null }> {
  return call(() =>
    phoneLinkUploadDiagnostics(JSON.stringify({ ...connection, file })),
  );
}

/** SHA-256 and size of a local file, read natively. */
export function fileSha256(
  file: string,
): Promise<{ sha256: string; size_bytes: number }> {
  return call(() => phoneLinkFileSha256(file));
}

/** Cuts a WAV recording after its first `keepMs`, in place. */
export function trimWav(
  file: string,
  keepMs: number,
): Promise<{ duration_ms: number; size_bytes: number }> {
  return call(() =>
    phoneLinkTrimWav(file, BigInt(Math.max(0, Math.round(keepMs)))),
  );
}

/**
 * The Mac's reason for refusing a request ("busy", "no_audio"…), when the
 * refusal came with one.
 */
export function refusalReason(error: unknown): string | null {
  if (!(error instanceof LinkError)) return null;
  return /:\s*([a-z_]+)\s*$/.exec(error.message)?.[1] ?? null;
}

/** The Mac answered that it doesn't know this request: its Mirna is older. */
export function isUnknownRequest(error: unknown): boolean {
  return error instanceof LinkError && /answered 404\b/.test(error.message);
}

/** Text of this phone's notes that changed on the Mac since `since`. */
export function noteChanges(
  connection: Connection,
  since: number,
  includeMacNotes: boolean,
): Promise<{
  notes: RemoteNote[];
  cursor: number;
  more: boolean;
  /** The Mac's courses; missing from a Mac that predates lessons. */
  courses?: CourseInfo[];
  working_host: string | null;
}> {
  return call(() =>
    phoneLinkNoteChanges(
      JSON.stringify({
        ...connection,
        since,
        include_mac_notes: includeMacNotes,
      }),
    ),
  );
}

export function complete(
  connection: Connection,
  input: { recordingId: string; file: string; meta: RecordingMeta },
): Promise<{ status: RemoteStatus; working_host: string | null }> {
  return call(() =>
    phoneLinkComplete(
      JSON.stringify({
        ...connection,
        recording_id: input.recordingId,
        file: input.file,
        meta: input.meta,
      }),
    ),
  );
}

/** Downloads one of a lesson's teacher clips into `file`, checked against `sha256`. */
export function downloadClip(
  connection: Connection,
  input: { sessionId: string; clipId: string; file: string; sha256: string },
): Promise<{ size: number; working_host: string | null }> {
  return call(() =>
    phoneLinkDownloadClip(
      JSON.stringify({
        ...connection,
        session_id: input.sessionId,
        clip_id: input.clipId,
        file: input.file,
        sha256: input.sha256,
      }),
    ),
  );
}

/** Sends reviews played on this phone (each the JSON of one run) to the Mac. */
export function sendReviews(
  connection: Connection,
  sessionId: string,
  reviews: string[],
): Promise<{ accepted: string[]; working_host: string | null }> {
  return call(() =>
    phoneLinkSendReviews(
      JSON.stringify({ ...connection, session_id: sessionId, reviews }),
    ),
  );
}
