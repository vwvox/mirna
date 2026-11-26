import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as transcriptionCommands } from "@anlg/plugin-transcription";

import { liveQueryClient } from "~/db";
import type { NamedSpeakerVoice } from "~/stt/queries";

// Runs after a transcript is persisted and before audio retention may delete
// the recording — the embeddings must outlive the audio. Failures are logged
// and swallowed: losing candidates for one session is acceptable, blocking
// transcription completion is not.
// With "Remember speakers" off (`enabled: false`) it still runs, to name
// speakers from voices the user chose to remember, but keeps no new voices.
export async function maybeExtractVoiceprintCandidates(input: {
  enabled: boolean;
  sessionId: string;
  transcriptId: string;
  audioPath: string | null | undefined;
}): Promise<void> {
  if (!input.audioPath) {
    return;
  }

  try {
    const result = await transcriptionCommands.extractVoiceprintCandidates(
      input.sessionId,
      input.transcriptId,
      input.audioPath,
      input.enabled,
    );
    if (result.status === "error") {
      console.error("[voiceprint] candidate extraction failed", result.error);
    }
  } catch (error) {
    console.error("[voiceprint] candidate extraction failed", error);
  }
}

export async function rememberSpeakerVoice(
  sessionId: string,
  voice: NamedSpeakerVoice,
): Promise<number | null> {
  try {
    const pathResult = await fsSyncCommands.audioPath(sessionId);
    if (pathResult.status === "error") {
      return null;
    }
    const result = await transcriptionCommands.rememberSpeakerVoice(
      sessionId,
      voice.transcriptId,
      pathResult.data,
      voice.speakerChannel,
      voice.speakerIndex,
      voice.humanId,
    );
    if (result.status === "error") {
      console.error("[voiceprint] remembering voice failed", result.error);
      return null;
    }
    return result.data;
  } catch (error) {
    console.error("[voiceprint] remembering voice failed", error);
    return null;
  }
}

export async function hasRememberedVoice(humanId: string): Promise<boolean> {
  const rows = await liveQueryClient.execute<{ remembered: number }>(
    `
      SELECT EXISTS(
        SELECT 1 FROM voiceprint_exemplars
        WHERE human_id = ? AND deleted_at IS NULL
      ) AS remembered
    `,
    [humanId],
  );
  return rows[0]?.remembered === 1;
}
