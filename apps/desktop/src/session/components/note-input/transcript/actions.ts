import { t } from "@lingui/core/macro";
import { useCallback } from "react";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { toast } from "@anlg/ui/components/ui/toast";

import { liveQueryClient } from "~/db";
import { withCloudsyncActivity } from "~/db/cloudsync-activity";
import { getEnhancerService } from "~/services/enhancer";
import {
  clearSummaryOutdated,
  markSummaryOutdated,
} from "~/session/summary-outdated";
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

/** The summary was written from the old transcript: offer to write it again. */
function offerSummaryUpdate(sessionId: string) {
  toast.success(t`Transcript updated`, {
    id: `summary-outdated-${sessionId}`,
    description: t`The summary still reflects the old transcript.`,
    duration: 12_000,
    action: {
      label: t`Update summary`,
      onClick: () => {
        void clearSummaryOutdated(sessionId);
        void getEnhancerService()?.requestAutoEnhance(sessionId, "refresh");
      },
    },
  });
}

/**
 * When the recording was made, from the transcripts it already has, so a new
 * transcript keeps that date. A phone matches its own recording by this date.
 */
export async function existingCaptureInterval(
  sessionId: string,
): Promise<{ startedAtMs: number; stoppedAtMs: number } | undefined> {
  const [row] = await liveQueryClient.execute<{
    started_at_ms: number | null;
    ended_at_ms: number | null;
  }>(
    `SELECT MIN(started_at_ms) AS started_at_ms, MAX(ended_at_ms) AS ended_at_ms
    FROM transcripts
    WHERE session_id = ? AND deleted_at IS NULL AND started_at_ms > 0`,
    [sessionId],
  );
  const startedAtMs = Number(row?.started_at_ms);
  const stoppedAtMs = Number(row?.ended_at_ms);
  if (
    !Number.isSafeInteger(startedAtMs) ||
    !Number.isSafeInteger(stoppedAtMs) ||
    stoppedAtMs <= startedAtMs
  ) {
    return undefined;
  }
  return { startedAtMs, stoppedAtMs };
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
      const captureInterval = await existingCaptureInterval(sessionId).catch(
        () => undefined,
      );

      try {
        await withCloudsyncActivity(
          "transcription",
          `${sessionId}:retranscription:${crypto.randomUUID()}`,
          async () => {
            await runBatch(audioPath, {
              promotion: { scope: "whole_session" },
              ...choice,
              ...(captureInterval ? { captureInterval } : {}),
            });
            const summary =
              await getEnhancerService()?.queueAutoEnhanceIfSummaryEmpty(
                sessionId,
              );
            if (summary?.type === "summary_exists") {
              await markSummaryOutdated(sessionId);
              offerSummaryUpdate(sessionId);
            }
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
