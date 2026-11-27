import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import {
  ControlSize,
  CornerCurve,
  FontFamily,
  Spacing,
} from "@/constants/theme";
import { useIsLesson } from "@/lesson/use-lesson";
import { usePairedMac } from "@/mac-link/pairing";
import { useSendMode } from "@/mac-link/schedule";
import { retryRecordingOnMac, sendRecordingsToMac } from "@/mac-link/sender";
import { type MacLinkStatus, useMacLinkStatus } from "@/mac-link/status";
import {
  isOnItsWay,
  type ProgressStep,
  progressSteps,
  retryProblem,
} from "@/note/mac-progress";
import { createStyleHook, useColors } from "@/settings/theme-provider";

/**
 * Where this recording is on its way to the Mac, which transcribes and
 * summarizes it: the steps while it's on its way, or what went wrong.
 * Nothing once the note is back.
 */
export function RecordingSyncCard({
  sessionId,
  saved,
  offerPairing = false,
  onPlay,
}: {
  sessionId: string;
  /** This phone's recording, for the first step. */
  saved: { lengthMs: number | null; sizeBytes: number | null };
  /** Not paired: say how to get notes from it. */
  offerPairing?: boolean;
  /** Plays the recording on this phone (from the failed card). */
  onPlay?: () => void;
}) {
  const { mac, loading } = usePairedMac();
  const status = useMacLinkStatus(sessionId);

  if (loading || !status) return null;
  if (!mac) return offerPairing ? <PairForNotesCard /> : null;
  if (status.state === "failed") {
    return (
      <FailedCard
        sessionId={sessionId}
        status={status}
        macName={mac.mac_name}
        onPlay={onPlay}
      />
    );
  }
  if (!isOnItsWay(status)) return null;
  return (
    <ProgressCard
      sessionId={sessionId}
      status={status}
      macName={mac.mac_name}
      saved={saved}
    />
  );
}

function ProgressCard({
  sessionId,
  status,
  macName,
  saved,
}: {
  sessionId: string;
  status: MacLinkStatus;
  macName: string;
  saved: { lengthMs: number | null; sizeBytes: number | null };
}) {
  const lesson = useIsLesson(sessionId);
  const styles = useStyles();
  const Colors = useColors();
  const sendMode = useSendMode();
  const sendNow = useMutation({
    mutationFn: () => sendRecordingsToMac("user"),
  });
  const steps = progressSteps(status, macName, saved, sendMode, lesson);

  return (
    <View accessibilityLabel="Progress" style={styles.card}>
      {steps.map((step, index) => (
        <View key={step.key} style={styles.step}>
          <View style={styles.rail}>
            <StepMarker state={step.state} />
            {index < steps.length - 1 && (
              <View
                style={[styles.line, step.state === "done" && styles.lineDone]}
              />
            )}
          </View>
          <View style={styles.stepCopy}>
            <View
              accessible
              accessibilityLabel={`${step.label}. ${step.detail}. ${STATE_LABEL[step.state]}`}
              accessibilityLiveRegion={
                step.state === "active" ? "polite" : "none"
              }
            >
              <Text
                style={[
                  styles.stepLabel,
                  step.state === "todo" && styles.stepLabelTodo,
                ]}
              >
                {step.label}
              </Text>
              <Text style={styles.stepDetail}>{step.detail}</Text>
            </View>
            {step.percent !== undefined && (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${step.percent}%` }]} />
              </View>
            )}
            {step.key === "send" && step.state === "waiting" && (
              <Pressable
                accessibilityRole="button"
                disabled={sendNow.isPending}
                onPress={() => sendNow.mutate()}
                style={({ pressed }) => [
                  styles.sendNow,
                  (pressed || sendNow.isPending) && styles.pressed,
                ]}
              >
                <Text style={styles.sendNowLabel}>
                  {sendNow.isPending ? "Sending…" : "Send now"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      <View style={styles.privacy}>
        <Ionicons
          name="lock-closed-outline"
          size={16}
          color={Colors.muted}
          style={styles.privacyIcon}
        />
        <Text style={styles.privacyText}>
          Nothing goes to the cloud. You can close Mirna; it keeps going in the
          background while you’re on the same Wi-Fi as your Mac.
        </Text>
      </View>
    </View>
  );
}

const STATE_LABEL: Record<ProgressStep["state"], string> = {
  done: "Done",
  active: "In progress",
  waiting: "Waiting",
  todo: "Not started",
};

function StepMarker({ state }: { state: ProgressStep["state"] }) {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View
      style={[
        styles.marker,
        state === "done"
          ? styles.markerDone
          : state === "active"
            ? styles.markerActive
            : state === "waiting"
              ? styles.markerWaiting
              : styles.markerTodo,
      ]}
    >
      {state === "done" && (
        <Ionicons name="checkmark" size={15} color={Colors.primaryForeground} />
      )}
      {state === "active" && <View style={styles.markerDot} />}
    </View>
  );
}

function FailedCard({
  sessionId,
  status,
  macName,
  onPlay,
}: {
  sessionId: string;
  status: MacLinkStatus;
  macName: string;
  onPlay?: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const retry = useMutation({
    mutationFn: () => retryRecordingOnMac(sessionId),
  });
  const problem = retry.data ? retryProblem(retry.data, macName) : null;

  return (
    <View style={styles.failedGroup}>
      <View style={styles.failed}>
        <View style={styles.failedTitleRow}>
          <Ionicons
            name="alert-circle-outline"
            size={20}
            color={Colors.alertForeground}
          />
          <Text accessibilityRole="header" style={styles.failedTitle}>
            {macName} couldn’t transcribe this
          </Text>
        </View>
        <Text style={styles.failedBody}>
          {status.error?.trim() ||
            "Something went wrong on the Mac. Try again, or play it back to check the recording."}
        </Text>
        {(problem || retry.error) && (
          <Text accessibilityLiveRegion="polite" style={styles.failedProblem}>
            {problem
              ? `${problem.title}. ${problem.description}`
              : `${macName} didn’t take it back. Try again in a moment.`}
          </Text>
        )}
        <View style={styles.failedActions}>
          <Pressable
            accessibilityRole="button"
            disabled={retry.isPending}
            onPress={() => retry.mutate()}
            style={({ pressed }) => [
              styles.tryAgain,
              (pressed || retry.isPending) && styles.pressed,
            ]}
          >
            <Text style={styles.tryAgainLabel}>
              {retry.isPending ? "Trying again…" : "Try again"}
            </Text>
          </Pressable>
          {onPlay && (
            <Pressable
              accessibilityLabel="Play the recording"
              accessibilityRole="button"
              onPress={onPlay}
              style={({ pressed }) => [
                styles.playIt,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.playItLabel}>Play it</Text>
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.safeLine}>
        <Ionicons
          name="shield-checkmark-outline"
          size={16}
          color={Colors.muted}
          style={styles.privacyIcon}
        />
        <Text style={styles.privacyText}>
          The recording and your notes are still safe on this phone.
        </Text>
      </View>
    </View>
  );
}

function PairForNotesCard() {
  const styles = useStyles();
  const router = useRouter();
  return (
    <View style={styles.pair}>
      <Text accessibilityRole="header" style={styles.pairTitle}>
        Saved on this phone
      </Text>
      <Text style={styles.pairBody}>
        Pair with your Mac to get a transcript and a summary. Nothing goes to
        the cloud.
      </Text>
      <Pressable
        accessibilityLabel="Pair now with your Mac"
        accessibilityRole="button"
        onPress={() => router.push("/settings/mac")}
        style={({ pressed }) => [styles.tryAgain, pressed && styles.pressed]}
      >
        <Text style={styles.tryAgainLabel}>Pair now</Text>
      </Pressable>
    </View>
  );
}

const MARKER = 24;

const useStyles = createStyleHook((Colors) => ({
  card: {
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
  },
  step: { flexDirection: "row", gap: 14 },
  rail: { width: MARKER, alignItems: "center" },
  marker: {
    width: MARKER,
    height: MARKER,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: MARKER / 2,
  },
  markerDone: { backgroundColor: Colors.primary },
  markerActive: {
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.accentSurface,
  },
  markerWaiting: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: Colors.muted,
  },
  markerTodo: { borderWidth: 2, borderColor: Colors.border },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  line: {
    flex: 1,
    width: 2,
    minHeight: Spacing.md,
    backgroundColor: Colors.border,
  },
  lineDone: { backgroundColor: Colors.primary },
  stepCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingTop: 2,
    paddingBottom: 18,
  },
  stepLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.ink,
  },
  stepLabelTodo: { color: Colors.muted },
  stepDetail: {
    marginTop: 3,
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
  track: {
    height: 4,
    marginTop: 6,
    borderRadius: 2,
    backgroundColor: Colors.accentSurface,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  sendNow: {
    alignSelf: "flex-start",
    minHeight: ControlSize.default,
    justifyContent: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 22,
    backgroundColor: Colors.background,
  },
  sendNowLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primary,
  },
  pressed: { opacity: 0.7 },
  privacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: Spacing.compact,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  privacyIcon: { marginTop: 1 },
  privacyText: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
  failedGroup: { gap: 14 },
  failed: {
    gap: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.alertBorder,
    borderRadius: 18,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.alert,
  },
  failedTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  failedTitle: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: Colors.alertForeground,
  },
  failedBody: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.alertForeground,
  },
  failedProblem: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.alertForeground,
  },
  failedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  tryAgain: {
    alignSelf: "flex-start",
    minHeight: ControlSize.default,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: Colors.primary,
  },
  tryAgainLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
  playIt: {
    minHeight: ControlSize.default,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: Colors.alertBorder,
    borderRadius: 22,
    backgroundColor: Colors.background,
  },
  playItLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.alertForeground,
  },
  safeLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  pair: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
  },
  pairTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    color: Colors.primary,
  },
  pairBody: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.ink,
  },
}));
