import { t } from "@lingui/core/macro";
import { useCallback } from "react";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { toast } from "@anlg/ui/components/ui/toast";

import { withCloudsyncActivity } from "~/db/cloudsync-activity";
import { getEnhancerService } from "~/services/enhancer";
import { useListener } from "~/stt/contexts";
import { isStoppedTranscriptionError, useRunBatch } from "~/stt/useRunBatch";

/** An engine to transcribe with instead of the one in Settings. */
export type TranscriptEngineChoice = { provider: string; model: string };

function isEngineChoice(value: unknown): value is TranscriptEngineChoice {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TranscriptEngineChoice).provider === "string" &&
    typeof (value as TranscriptEngineChoice).model === "string"
  );
}

export function useRegenerateTranscript(sessionId: string) {
  const runBatch = useRunBatch(sessionId);
  const handleBatchFailed = useListener((state) => state.handleBatchFailed);

  // Buttons pass their click event here, so only a real engine choice counts.
  return useCallback(
    async (engine?: TranscriptEngineChoice | unknown) => {
      const choice = isEngineChoice(engine)
        ? { provider: engine.provider, model: engine.model }
        : {};
      const result = await fsSyncCommands.audioPath(sessionId);
      if (result.status === "error") {
        toast.error(t`Recording not found. It may have been deleted.`, {
          id: `transcript-regenerate-audio-missing-${sessionId}`,
        });
        return;
      }

      const audioPath = result.data;

      try {
        await withCloudsyncActivity(
          "transcription",
          `${sessionId}:retranscription:${crypto.randomUUID()}`,
          async () => {
            await runBatch(audioPath, {
              promotion: { scope: "whole_session" },
              ...choice,
            });
            await getEnhancerService()?.queueAutoEnhanceIfSummaryEmpty(
              sessionId,
            );
          },
        );
      } catch (error) {
        if (isStoppedTranscriptionError(error)) {
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        handleBatchFailed(sessionId, msg);
        toast.error(t`Re-transcription failed`, {
          id: `transcript-regenerate-failed-${sessionId}`,
          description: msg,
        });
      }
    },
    [handleBatchFailed, runBatch, sessionId],
  );
}
