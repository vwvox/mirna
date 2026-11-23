// Pure helpers for the phone's link to the Mac (no React Native imports, so
// they run under node's test runner).

export type MacLinkState =
  | "waiting" // not on the Mac yet
  | "sending"
  | "on_mac" // all audio arrived, waiting its turn
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed"; // the Mac could not make a note of it

/** A recording added to the note on the Mac. Its audio stays there. */
export type MacOnlyRecording = { id: string; duration_ms: number | null };

export type MacLinkStatus = {
  state: MacLinkState;
  sent_bytes?: number;
  total_bytes?: number;
  error?: string | null;
  mac_session_id?: string | null;
  updated_at?: string;
  /** Recordings added to this note on the Mac (text only on the phone). */
  mac_recordings?: MacOnlyRecording[];
  /** When the Mac last changed this note after it first came back. */
  updated_on_mac_at?: string | null;
  /** What the phone last took from the Mac, to spot later changes. */
  synced?: {
    title?: string | null;
    summary_hash?: string | null;
    transcripts_hash?: string | null;
  };
};

/** Fields that survive progress updates (they describe the finished note). */
export function keepSyncedFields(status: MacLinkStatus) {
  return {
    ...(status.mac_recordings ? { mac_recordings: status.mac_recordings } : {}),
    ...(status.updated_on_mac_at
      ? { updated_on_mac_at: status.updated_on_mac_at }
      : {}),
    ...(status.synced ? { synced: status.synced } : {}),
  };
}

// --- When to talk to the Mac -------------------------------------------------

/** Why the phone is contacting the Mac, strongest first. */
export type SendTrigger =
  | "user" // Sync now, pull to refresh: do everything now
  | "open" // the app opened or a recording just stopped
  | "interval" // every 30 s while the app is open and something is on its way
  | "background"; // Android's background job

export type SendMode = "auto" | "manual";

const TRIGGER_STRENGTH: Record<SendTrigger, number> = {
  background: 0,
  interval: 1,
  open: 2,
  user: 3,
};

export function strongerTrigger(a: SendTrigger, b: SendTrigger): SendTrigger {
  return TRIGGER_STRENGTH[a] >= TRIGGER_STRENGTH[b] ? a : b;
}

/**
 * Whether this recording still needs the Mac: to send it (only when sending
 * is automatic), or to hear back while the Mac works on it. Finished and
 * failed ones don't keep the phone checking.
 */
export function needsMacContact(status: MacLinkStatus, mode: SendMode) {
  switch (status.state) {
    case "waiting":
    case "sending":
      return mode === "auto";
    case "on_mac":
    case "transcribing":
    case "summarizing":
      return true;
    default:
      return false;
  }
}

export type Backoff = {
  failures: number;
  next_at_ms: number;
  network: string | null;
};

const BACKOFF_MINUTES = [15, 30, 60];

/** After the Mac couldn't be reached: wait 15, then 30, then 60 minutes. */
export function backoffAfterFailure(
  previous: Backoff | null,
  network: string | null,
  nowMs: number,
): Backoff {
  const failures =
    previous && previous.network === network ? previous.failures + 1 : 1;
  const minutes =
    BACKOFF_MINUTES[Math.min(failures, BACKOFF_MINUTES.length) - 1] ?? 60;
  return { failures, next_at_ms: nowMs + minutes * 60_000, network };
}

/** Joining a different Wi-Fi ends the wait. */
export function isBackingOff(
  backoff: Backoff | null,
  network: string | null,
  nowMs: number,
) {
  return (
    !!backoff && backoff.network === network && nowMs < backoff.next_at_ms
  );
}

/** Wi-Fi networks where the Mac answered, most recent first. */
export function rememberNetwork(known: string[], network: string, max = 8) {
  return [network, ...known.filter((entry) => entry !== network)].slice(0, max);
}

/**
 * Whether the phone should look for the Mac on this Wi-Fi without being
 * asked. Before the Mac has answered anywhere, every Wi-Fi counts.
 */
export function isHomeNetwork(known: string[], network: string | null) {
  if (!network) return false;
  return known.length === 0 || known.includes(network);
}

// --- Notes coming back from the Mac -----------------------------------------

export type RemoteTranscript = {
  id: string;
  started_at_ms: number;
  ended_at_ms: number | null;
  memo: string;
  words_json: string;
  speaker_hints_json: string;
};

export type RemoteNote = {
  /** The phone's recording id, or null for a note recorded on the Mac. */
  recording_id: string | null;
  session_id: string;
  title: string;
  summary_md: string | null;
  transcripts: RemoteTranscript[];
  /** When a note recorded on the Mac was made. */
  created_at?: string | null;
};

/** The phone's id for a note that was recorded on the Mac. */
export function macNoteSessionId(macSessionId: string) {
  return `mac-${macSessionId}`;
}

/**
 * Recordings added on the Mac: every transcript except the one made from this
 * phone's recording, which the Mac dates when the phone started recording.
 * Notes processed before that dating fall back to the earliest transcript.
 */
export function macOnlyRecordings(
  transcripts: RemoteTranscript[],
  phoneStartedAtMs: number | null,
): MacOnlyRecording[] {
  if (transcripts.length === 0) return [];
  const sorted = transcripts
    .slice()
    .sort((a, b) => a.started_at_ms - b.started_at_ms);
  const phoneOwn =
    (phoneStartedAtMs !== null &&
      sorted.find(
        (transcript) =>
          Math.abs(transcript.started_at_ms - phoneStartedAtMs) <= 60_000,
      )) ||
    sorted[0];
  return sorted
    .filter((transcript) => transcript !== phoneOwn)
    .map((transcript) => ({
      id: transcript.id,
      duration_ms:
        transcript.ended_at_ms !== null &&
        transcript.ended_at_ms > transcript.started_at_ms
          ? transcript.ended_at_ms - transcript.started_at_ms
          : null,
    }));
}

/** A short, stable fingerprint of some text (FNV-1a), to spot changes. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + text.length.toString(36);
}

export function parseMacLink(raw: string | null | undefined): MacLinkStatus {
  if (!raw) return { state: "waiting" };
  try {
    const parsed = JSON.parse(raw) as MacLinkStatus;
    return parsed && typeof parsed.state === "string"
      ? parsed
      : { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}

export function describeMacLink(status: MacLinkStatus, macName?: string) {
  const mac = macName || "your Mac";
  switch (status.state) {
    case "waiting":
      return `Waiting for ${mac}`;
    case "sending": {
      const total = status.total_bytes ?? 0;
      const percent =
        total > 0
          ? Math.min(99, Math.floor(((status.sent_bytes ?? 0) / total) * 100))
          : 0;
      return `Sending to ${mac} · ${percent}%`;
    }
    case "on_mac":
      return `On ${mac} · waiting to transcribe`;
    case "transcribing":
      return `Transcribing on ${mac}`;
    case "summarizing":
      return `Summarizing on ${mac}`;
    case "done":
      return `Transcribed on ${mac}`;
    case "failed":
      return status.error || `${mac} could not transcribe this recording`;
  }
}

// Recordings made in the app are 16 kHz mono 16-bit WAV.
export function wavDurationMs(filename: string, bytes: number): number | null {
  if (!filename.toLowerCase().endsWith(".wav") || bytes <= 44) return null;
  return Math.round(((bytes - 44) / (16_000 * 2)) * 1000);
}

type PmNode = {
  type?: string;
  text?: string;
  attrs?: { level?: number; checked?: boolean };
  content?: PmNode[];
};

/** Plain Markdown from the note editor's document: enough for the Mac's summary. */
export function proseMirrorToMarkdown(node: PmNode, depth = 0): string {
  const children = (separator: string, childDepth = depth) =>
    (node.content ?? [])
      .map((child) => proseMirrorToMarkdown(child, childDepth))
      .filter((text) => text.length > 0)
      .join(separator);
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, node.attrs?.level ?? 1)))} ${children("")}`;
    case "paragraph":
      return children("");
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (node.content ?? [])
        .map((item, index) => {
          const marker =
            node.type === "orderedList"
              ? `${index + 1}.`
              : node.type === "taskList"
                ? item.attrs?.checked
                  ? "- [x]"
                  : "- [ ]"
                : "-";
          const body = (item.content ?? [])
            .map((child) => proseMirrorToMarkdown(child, depth + 1))
            .filter(Boolean)
            .join("\n");
          return `${"  ".repeat(depth)}${marker} ${body}`;
        })
        .join("\n");
    case "blockquote":
      return children("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    default:
      return children(depth === 0 ? "\n\n" : "\n");
  }
}
