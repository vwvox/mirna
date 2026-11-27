import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { hasRecordingInProgress, useRecorder } from "@/audio/recorder-provider";
import { describeElapsed, formatElapsed } from "@/audio/recorder-status";
import { CornerCurve, FontFamily } from "@/constants/theme";
import { useSessionDetail } from "@/data/session";
import { createStyleHook, useColors } from "@/settings/theme-provider";

const BUTTON_HEIGHT = 56;

/**
 * The notes list's main button: Start recording, or, while a recording is
 * going, the way back to it (with Stop), so leaving a recording's note
 * never loses it.
 */
export function StartOrReturnButton({ onStart }: { onStart: () => void }) {
  const styles = useStyles();
  const Colors = useColors();
  const recorder = useRecorder();

  if (!hasRecordingInProgress(recorder) || !recorder.sessionId) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onStart}
        style={({ pressed }) => [styles.start, pressed && styles.pressed]}
      >
        <Ionicons
          name="mic-outline"
          size={22}
          color={Colors.primaryForeground}
        />
        <Text style={styles.startLabel}>Start recording</Text>
      </Pressable>
    );
  }
  return <RecordingInProgress sessionId={recorder.sessionId} />;
}

function RecordingInProgress({ sessionId }: { sessionId: string }) {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const recorder = useRecorder();
  const { data } = useSessionDetail(sessionId);
  const { phase, durationMs } = recorder;
  const title = data?.title.trim() || "Untitled";
  const status =
    phase === "paused"
      ? "Paused"
      : phase === "saving"
        ? "Saving…"
        : phase === "save_error"
          ? "Not saved yet"
          : phase === "starting"
            ? "Getting ready…"
            : "Recording";
  const canStop = phase === "recording" || phase === "paused";

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityHint="Opens the note being recorded"
        accessibilityLabel={`${status}, ${describeElapsed(durationMs)}, ${title}`}
        accessibilityRole="button"
        onPress={() => router.push(`/note/${sessionId}`)}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.state}
        >
          {phase === "recording" ? (
            <View style={styles.dotHalo}>
              <View style={styles.dot} />
            </View>
          ) : phase === "paused" ? (
            <Ionicons name="pause" size={16} color={Colors.muted} />
          ) : phase === "save_error" ? (
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={Colors.alertForeground}
            />
          ) : (
            <ActivityIndicator size="small" color={Colors.muted} />
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.status} numberOfLines={1}>
            {status} ·{" "}
            <Text style={styles.time}>{formatElapsed(durationMs)}</Text>
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
      </Pressable>
      {canStop && (
        <Pressable
          accessibilityLabel="Stop and save the recording"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => void recorder.stop("app_button")}
          style={({ pressed }) => [styles.stop, pressed && styles.pressed]}
        >
          <Ionicons
            name="stop"
            size={18}
            color={Colors.destructiveForeground}
          />
        </Pressable>
      )}
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  start: {
    height: BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: BUTTON_HEIGHT / 2,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.primary,
  },
  startLabel: {
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
  pressed: { opacity: 0.75 },
  bar: {
    height: BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8,
    borderRadius: BUTTON_HEIGHT / 2,
    borderCurve: CornerCurve.squircle,
    borderWidth: 1,
    borderColor: Colors.alertBorder,
    backgroundColor: Colors.alert,
  },
  open: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 18,
    paddingRight: 4,
    borderRadius: BUTTON_HEIGHT / 2,
  },
  state: { width: 18, alignItems: "center" },
  dotHalo: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: Colors.background,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.accent,
  },
  copy: { flex: 1, gap: 1 },
  status: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.alertForeground,
  },
  time: { fontFamily: FontFamily.mono, fontWeight: "500" },
  title: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 17,
    color: Colors.ink,
  },
  stop: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: Colors.destructive,
  },
}));
