import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";

import { MarkdownView } from "@/components/markdown-view";
import { RemoteAudioCard } from "@/components/remote-audio-card";
import { Button } from "@/components/ui/button";
import { Spacing, Typography } from "@/constants/theme";
import type { SessionDetail } from "@/data/session-detail";
import {
  notifySummarySkipped,
  SummarySkippedError,
  summarizeSession,
  summaryRecoveryOptions,
  useSessionSummaryState,
} from "@/data/summarize";
import { transcribeSession, useTranscriptionState } from "@/data/transcribe";
import { usePairedMac } from "@/mac-link/pairing";
import { describeMacLink, useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook } from "@/settings/theme-provider";
import { useProviderAccess } from "@/settings/use-provider-access";

import type { useNoteAudio } from "./use-note-audio";

export function NoteSummary({
  sessionId,
  active,
  visible,
  summary,
  hasTranscript,
  audio,
  onBeforeGenerate,
}: {
  sessionId: string;
  active: boolean;
  visible: boolean;
  summary: SessionDetail["summary"];
  hasTranscript: boolean;
  audio: ReturnType<typeof useNoteAudio>;
  onBeforeGenerate: () => Promise<void> | void;
}) {
  const styles = useStyles();
  const canTranscribe = useProviderAccess("stt");
  const canSummarize = useProviderAccess("llm");
  const summaryState = useSessionSummaryState(sessionId);
  const transcription = useTranscriptionState(sessionId);
  const { mac } = usePairedMac();
  const macLink = useMacLinkStatus(sessionId);
  useQuery(
    summaryRecoveryOptions(
      sessionId,
      visible &&
        !active &&
        hasTranscript &&
        canSummarize &&
        audio.data?.transcriptStatus === "complete" &&
        transcription !== "running",
    ),
  );
  const summaryPending = summaryState?.status === "pending";
  const summaryError = summaryState?.error;
  const summarySkipped = summaryError instanceof SummarySkippedError;
  const needsTranscription =
    Boolean(audio.data) && audio.data?.transcriptStatus !== "complete";

  if (!visible) return null;
  return (
    <ScrollView
      style={styles.summaryScroll}
      contentContainerStyle={styles.summary}
    >
      {summary && (
        <View>
          {summary.title !== "Summary" && (
            <Text style={styles.summaryTitle}>{summary.title}</Text>
          )}
          <MarkdownView markdown={summary.text} />
        </View>
      )}
      {!summary && (
        <Text style={styles.summaryText}>
          {active
            ? "Your summary will be generated after the meeting."
            : summaryPending
              ? "Generating summary…"
              : transcription === "running"
                ? "Finishing transcription. Your summary will follow automatically."
                : needsTranscription && mac && macLink && !canTranscribe
                  ? macLink.state === "failed"
                    ? describeMacLink(macLink, mac.mac_name)
                    : `${describeMacLink(macLink, mac.mac_name)}. The summary will appear here when the Mac has made it.`
                : needsTranscription
                  ? canTranscribe
                    ? "Your recording is saved. Finish transcription to get your summary."
                    : "Your recording is saved on this phone. Pair with your Mac in Settings › Mac and it will be transcribed there."
                  : "Your meeting summary will appear here. Your memos are in the Memos tab."}
        </Text>
      )}
      {!active && needsTranscription && transcription !== "running" && (
        <>
          {!audio.availableLocally && <RemoteAudioCard {...audio.restore} />}
          {audio.availableLocally && canTranscribe && (
            <Button
              label="Retry transcription"
              variant="ghost"
              size="small"
              onPress={() => void transcribeSession(sessionId)}
            />
          )}
        </>
      )}
      {summaryError && (
        <Text accessibilityRole="alert" style={styles.summaryError}>
          {summaryError.message}
        </Text>
      )}
      {!active &&
        !needsTranscription &&
        canSummarize &&
        (summaryError || summary || hasTranscript) && (
          <Button
            label={
              summaryError && !summarySkipped
                ? "Retry summary"
                : summary
                  ? "Regenerate summary"
                  : "Generate summary"
            }
            loading={summaryPending}
            disabled={transcription === "running"}
            variant="ghost"
            size="small"
            onPress={() =>
              void summarizeSession(sessionId, {
                beforeGenerate: onBeforeGenerate,
              }).catch((error) => notifySummarySkipped(sessionId, error))
            }
          />
        )}
    </ScrollView>
  );
}

const useStyles = createStyleHook((Colors) => ({
  summary: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  summaryTitle: { ...Typography.section, color: Colors.ink },
  summaryScroll: { flex: 1 },
  summaryText: { ...Typography.body, color: Colors.ink },
  summaryError: {
    ...Typography.caption,
    color: Colors.accent,
    marginTop: Spacing.sm,
  },
}));
