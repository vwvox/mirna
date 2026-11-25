// Cutting the end off a recording, on this phone and on the Mac. The Mac goes
// first when it already has the recording, so the two never disagree: if the
// Mac can't be reached, nothing is cut anywhere.
import { File, FileMode, Paths } from "expo-file-system";

import { recoverableWav, WAV_HEADER_BYTES } from "@/audio/pcm-wav";
import { refreshSessionAudioFile } from "@/data/audio-catalog";
import { logDiagnostic, logDiagnosticError } from "@/lib/diagnostics";
import { trimWav } from "@/mac-link/bridge";
import { loadPairedMac } from "@/mac-link/pairing";
import {
  type NoteJobOutcome,
  requestNoteJob,
  sendRecordingsToMac,
} from "@/mac-link/sender";
import { loadMacLinkStatus } from "@/mac-link/status";

import { pcmRms } from "./trim-model";

/** Loudness at `points` evenly spaced moments, read straight from the file. */
export function sampleLevels(
  file: File,
  points = 360,
): { levels: number[]; lengthMs: number } | null {
  if (!file.exists || (file.size ?? 0) <= WAV_HEADER_BYTES) return null;
  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = 0;
    const format = recoverableWav(
      handle.readBytes(WAV_HEADER_BYTES),
      file.size ?? 0,
    );
    if (!format) return null;
    const bytesPerSecond = format.sampleRate * format.channels * 2;
    const window = Math.floor(bytesPerSecond / 10) & ~1;
    const levels: number[] = [];
    for (let point = 0; point < points; point += 1) {
      const start =
        Math.floor((format.dataBytes - window) * (point / points)) & ~1;
      handle.offset = WAV_HEADER_BYTES + Math.max(0, start);
      levels.push(pcmRms(handle.readBytes(window)));
    }
    return {
      levels,
      lengthMs: Math.round((format.dataBytes / bytesPerSecond) * 1000),
    };
  } finally {
    handle.close();
  }
}

export type TrimOutcome =
  | { ok: true; onMac: boolean }
  | { ok: false; reason: NoteJobOutcome | "failed" };

/**
 * Keeps the first `keepMs` of the recording. When the Mac has some or all of
 * it, the Mac cuts its copy (and its transcript) first, then the phone.
 */
export async function trimRecording(input: {
  sessionId: string;
  filename: string | null;
  availableLocally: boolean;
  keepMs: number;
  updateSummary: boolean;
}): Promise<TrimOutcome> {
  const { sessionId, keepMs } = input;
  logDiagnostic("trim_requested", { keep_ms: keepMs });
  const status = await loadMacLinkStatus(sessionId);
  const paired = Boolean(await loadPairedMac());
  const macHasIt = paired && status.state !== "waiting";

  let onMac = false;
  if (macHasIt) {
    const outcome = await requestNoteJob(sessionId, {
      type: "trim",
      keep_ms: keepMs,
      update_summary: input.updateSummary,
    });
    if (
      outcome !== "queued" &&
      outcome !== "trimmed_on_mac" &&
      outcome !== "send_again"
    ) {
      return { ok: false, reason: outcome };
    }
    onMac = outcome !== "send_again";
  }

  if (
    input.availableLocally &&
    input.filename?.toLowerCase().endsWith(".wav")
  ) {
    try {
      const file = new File(
        Paths.document,
        "sessions",
        sessionId,
        input.filename,
      );
      const trimmed = await trimWav(file.uri, keepMs);
      await refreshSessionAudioFile(sessionId, input.filename);
      logDiagnostic("trim_done_on_phone", {
        duration_ms: trimmed.duration_ms,
        bytes: trimmed.size_bytes,
      });
    } catch (error) {
      logDiagnosticError("trim_failed_on_phone", error);
      // The Mac's copy may already be cut; the phone's stays as it was.
      return { ok: false, reason: "failed" };
    }
  }
  if (!onMac && paired) void sendRecordingsToMac("user");
  return { ok: true, onMac };
}
