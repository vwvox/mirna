// Typed wrappers around the Rust bridge's phone-link calls. Everything that
// touches the network or crypto happens in Rust (crates/phone-link): mutual
// TLS pinned to each side's certificate, chunked upload, checksums.
import {
  phoneLinkComplete,
  phoneLinkInfo,
  phoneLinkNewIdentity,
  phoneLinkPair,
  phoneLinkParseOffer,
  phoneLinkSend,
  phoneLinkStatuses,
} from "@anlg/mobile-bridge";

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

export type RemoteStatus = {
  id: string;
  state: RemoteState;
  received_bytes: number;
  stage: string | null;
  session_id: string | null;
  title: string | null;
  summary_md: string | null;
  error: string | null;
};

export type RecordingMeta = {
  title: string | null;
  started_at: string | null;
  duration_ms: number | null;
  ext: string;
  notes_md: string | null;
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
