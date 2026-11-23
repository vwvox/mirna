// Pure helpers for showing where a recording is on its way to the Mac, on the
// home screen's cards and in the note. No React Native imports, so they run
// under node's test runner.
import { docToPlainText } from "../data/note-doc.ts";
import { parseMarkdownBlocks } from "../lib/markdown-blocks.ts";
import {
  type MacLinkStatus,
  type MacOnlyRecording,
  wavDurationMs,
} from "../mac-link/model.ts";

/** How long the home screen and the note point out a change made on the Mac. */
export const RECENT_UPDATE_MS = 2 * 24 * 60 * 60_000;

/** When the Mac last changed the note, if that was in the last two days. */
export function recentMacUpdate(
  status: MacLinkStatus | null | undefined,
  nowMs = Date.now(),
): Date | null {
  if (!status?.updated_on_mac_at) return null;
  const date = new Date(status.updated_on_mac_at);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return nowMs - time < RECENT_UPDATE_MS ? date : null;
}

export function sendPercent(status: MacLinkStatus): number {
  const total = status.total_bytes ?? 0;
  if (total <= 0) return 0;
  return Math.max(
    0,
    Math.min(99, Math.floor(((status.sent_bytes ?? 0) / total) * 100)),
  );
}

/** A length for lists and headers: "40 s", "6 min", "1 h 5 min". */
export function formatLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A player time: "4:05", "32:10", "1:02:03". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * How long the note's audio is: this phone's recording plus any added on the
 * Mac. Imported recordings that aren't WAV fall back to `fallbackMs` (their
 * transcripts, or what the player measured).
 */
export function noteLengthMs({
  filename,
  sizeBytes,
  macRecordings,
  fallbackMs,
}: {
  filename: string | null | undefined;
  sizeBytes: number | null | undefined;
  macRecordings?: MacOnlyRecording[] | null;
  fallbackMs?: number | null;
}): number | null {
  const phone =
    filename && sizeBytes ? wavDurationMs(filename, sizeBytes) : null;
  const onMac = (macRecordings ?? []).reduce(
    (sum, recording) => sum + (recording.duration_ms ?? 0),
    0,
  );
  if (phone !== null) return phone + onMac;
  if (fallbackMs && fallbackMs > 0) return fallbackMs;
  return onMac > 0 ? onMac : null;
}

const ENDS_SENTENCE = /[.!?:;…]$/;

/** The summary as one plain line for the home screen's two-line snippet. */
export function summarySnippet(
  body: string | null | undefined,
  bodyFormat: string | null | undefined,
): string | null {
  if (!body?.trim()) return null;
  const lines: string[] = [];
  if (bodyFormat === "markdown") {
    for (const block of parseMarkdownBlocks(body)) {
      if (block.type === "heading") continue;
      if (block.type === "paragraph") {
        lines.push(block.spans.map((span) => span.text).join(""));
      } else {
        for (const item of block.items) {
          lines.push(item.spans.map((span) => span.text).join(""));
        }
      }
    }
  } else {
    lines.push(...docToPlainText(body).text.split("\n"));
  }
  const text = lines
    .map((line) =>
      line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s+/, "").trim(),
    )
    .filter(Boolean)
    .map((line) => (ENDS_SENTENCE.test(line) ? line : `${line}.`))
    .join(" ");
  return text || null;
}

export type ProgressStepState = "done" | "active" | "waiting" | "todo";

export type ProgressStep = {
  key: "saved" | "send" | "transcribe" | "summary";
  state: ProgressStepState;
  label: string;
  detail: string;
  /** Sending progress, shown as a bar. */
  percent?: number;
};

const STAGE: Partial<Record<MacLinkStatus["state"], number>> = {
  waiting: 0,
  sending: 1,
  on_mac: 2,
  transcribing: 3,
  summarizing: 4,
  done: 5,
};

/** Whether the note shows the step-by-step progress card for this status. */
export function isOnItsWay(status: MacLinkStatus | null | undefined) {
  return !!status && (STAGE[status.state] ?? 5) < 5;
}

/** The four steps from this phone to a summary, for the note's progress card. */
export function progressSteps(
  status: MacLinkStatus,
  macName: string,
  saved: { lengthMs: number | null; sizeBytes: number | null },
  sendMode: "auto" | "manual" = "auto",
): ProgressStep[] {
  const at = STAGE[status.state] ?? 0;
  const percent = sendPercent(status);
  return [
    {
      key: "saved",
      state: "done",
      label: "Saved on this phone",
      detail:
        [
          saved.lengthMs ? formatLength(saved.lengthMs) : null,
          saved.sizeBytes ? formatSize(saved.sizeBytes) : null,
        ]
          .filter(Boolean)
          .join(" · ") || "The audio stays here until it reaches your Mac",
    },
    at === 0
      ? {
          key: "send",
          state: "waiting",
          label: "Waiting for your Mac",
          detail:
            sendMode === "manual"
              ? `Tap Send now when you’re on the same Wi-Fi as ${macName}.`
              : `Sends on its own when you’re on the same Wi-Fi as ${macName}.`,
        }
      : at === 1
        ? {
            key: "send",
            state: "active",
            label: `Sending to ${macName}`,
            detail: `${percent}% · over your Wi-Fi, encrypted`,
            percent,
          }
        : {
            key: "send",
            state: "done",
            label: `Sent to ${macName}`,
            detail: "Over your Wi-Fi, encrypted",
          },
    at < 2
      ? {
          key: "transcribe",
          state: "todo",
          label: `Transcribe on ${macName}`,
          detail: "On your Mac, not in the cloud",
        }
      : at === 2
        ? {
            key: "transcribe",
            state: "active",
            label: `Waiting its turn on ${macName}`,
            detail: "Another recording is being transcribed first.",
          }
        : at === 3
          ? {
              key: "transcribe",
              state: "active",
              label: `Transcribing on ${macName}`,
              detail: "On your Mac, not in the cloud",
            }
          : {
              key: "transcribe",
              state: "done",
              label: `Transcribed on ${macName}`,
              detail: "On your Mac, not in the cloud",
            },
    at < 4
      ? {
          key: "summary",
          state: "todo",
          label: "Summary",
          detail: "Appears here when your Mac has written it",
        }
      : at === 4
        ? {
            key: "summary",
            state: "active",
            label: "Writing the summary",
            detail: "Uses your notes too. It will appear here.",
          }
        : {
            key: "summary",
            state: "done",
            label: "Summary written",
            detail: "It’s here now",
          },
  ];
}

export type RetryOutcome =
  | "nothing_to_send"
  | "not_paired"
  | "not_on_wifi"
  | "mac_unreachable"
  | "unpaired_by_mac"
  | "other_mac"
  | "backing_off"
  | "away"
  | "recording"
  | "done";

/** What to tell someone whose "Try again" didn't reach the Mac. */
export function retryProblem(
  outcome: RetryOutcome,
  macName: string,
): { title: string; description: string } | null {
  switch (outcome) {
    case "done":
    case "nothing_to_send":
      return null;
    case "not_on_wifi":
      return {
        title: "Not on Wi-Fi",
        description: `Join the same Wi-Fi as ${macName}, or connect ${macName} to this phone’s hotspot, then try again.`,
      };
    case "unpaired_by_mac":
    case "other_mac":
      return {
        title: `${macName} doesn’t know this phone any more`,
        description: "Pair again in Settings › Mac.",
      };
    case "not_paired":
      return {
        title: "Not paired with a Mac",
        description: "Pair in Settings › Mac first.",
      };
    default:
      return {
        title: `Can’t reach ${macName}`,
        description: "Check that it’s awake and Mirna is open on it.",
      };
  }
}
