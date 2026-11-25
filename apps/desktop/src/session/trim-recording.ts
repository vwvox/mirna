import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as phoneLinkCommands } from "@anlg/plugin-phone-link";

import { liveQueryClient } from "~/db";
import { catalogLocalSessionAudio } from "~/session/attachments";
import { enqueueSessionAudioOperation } from "~/session/audio-operations";
import {
  lastWordEndMs,
  MIN_CUT_MS,
  type TrimBlocker,
} from "~/session/trim-model";
import {
  getSessionTranscriptRecords,
  trimTranscriptAfter,
} from "~/stt/queries";

export class TrimRefusedError extends Error {
  constructor(readonly reason: TrimBlocker) {
    super(`trim_refused:${reason}`);
    this.name = "TrimRefusedError";
  }
}

/** Whether a phone sent this note's recording (and so has its own copy). */
export async function isPhoneNote(sessionId: string): Promise<boolean> {
  try {
    const linked = await phoneLinkCommands.listLinkedNotes();
    return (
      linked.status === "ok" &&
      linked.data.some((note) => note.session_id === sessionId)
    );
  } catch (error) {
    console.error("[trim] could not read the phone's notes", error);
    return false;
  }
}

/** What the Trim dialog needs to know before offering a cut. */
export async function loadTrimContext(sessionId: string) {
  const [transcripts, fromPhone] = await Promise.all([
    getSessionTranscriptRecords(sessionId),
    isPhoneNote(sessionId),
  ]);
  return {
    transcriptCount: transcripts.length,
    talkEndsMs: lastWordEndMs(
      transcripts.flatMap((transcript) => transcript.words),
    ),
    fromPhone,
  };
}

/**
 * Keeps the first `keepMs` of a note's recording: the audio after it is cut
 * and so are the words said after it. Word times count from the start of the
 * audio file, which only holds for a note with one transcript. A cut asked for
 * on this Mac never touches a phone's note: the phone trims both copies.
 */
export async function trimSessionRecording(
  sessionId: string,
  keepMs: number,
  { requestedBy }: { requestedBy: "mac" | "phone" },
): Promise<{ audioTrimmed: boolean }> {
  const transcripts = await liveQueryClient.execute<{ id: string }>(
    `SELECT id FROM transcripts
    WHERE session_id = ? AND deleted_at IS NULL
    ORDER BY started_at_ms, created_at, id`,
    [sessionId],
  );
  if (transcripts.length > 1) {
    throw new TrimRefusedError("several_parts");
  }
  if (!Number.isFinite(keepMs) || keepMs < MIN_CUT_MS) {
    throw new TrimRefusedError("too_short");
  }
  if (requestedBy === "mac" && (await isPhoneNote(sessionId))) {
    throw new TrimRefusedError("from_phone");
  }

  const trimmed = await enqueueSessionAudioOperation(sessionId, async () => {
    const result = await fsSyncCommands.audioTrim(sessionId, keepMs);
    if (result.status === "error") throw new Error(result.error);
    if (result.data) {
      try {
        await catalogLocalSessionAudio(sessionId);
      } catch (error) {
        console.error("[trim] could not catalog the audio", error);
      }
    }
    return result.data;
  });
  for (const transcript of transcripts) {
    await trimTranscriptAfter(transcript.id, keepMs);
  }
  return { audioTrimmed: Boolean(trimmed) };
}
