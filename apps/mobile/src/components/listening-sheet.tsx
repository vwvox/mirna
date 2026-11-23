import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  RecorderFailure,
  RecorderPhase,
} from "@/audio/use-session-recorder";
import { CornerCurve, FontFamily, Radius, Spacing } from "@/constants/theme";
import { createStyleHook, useColors } from "@/settings/theme-provider";

const SIDE_BUTTON_SIZE = 64;
const STOP_BUTTON_SIZE = 78;

/**
 * The recording screen's controls: Pause or Resume beside Stop, or one way
 * out when the recorder needs attention.
 */
export function ListeningSheet({
  phase,
  failure,
  canPause,
  onPause,
  onResume,
  onStop,
  onRetry,
  onOpenSettings,
}: {
  phase: RecorderPhase;
  failure: RecorderFailure | null;
  canPause: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const permissionDenied =
    phase === "unavailable" &&
    (failure === "permission_denied" ||
      failure === "notification_permission_denied");
  const recoverable = ["interrupted", "save_error", "error"].includes(phase);

  if (permissionDenied || recoverable) {
    return (
      <View style={styles.dock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            permissionDenied ? "Open settings" : "Try again to save"
          }
          onPress={permissionDenied ? onOpenSettings : onRetry}
          style={({ pressed }) => [styles.wideButton, pressed && styles.pressed]}
        >
          <Text style={styles.wideButtonText}>
            {permissionDenied ? "Open settings" : "Try again"}
          </Text>
        </Pressable>
      </View>
    );
  }

  const paused = phase === "paused";
  const saving = phase === "saving";
  const pauseDisabled = phase !== "recording" && phase !== "paused";

  return (
    <View style={styles.dock}>
      {canPause ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? "Resume recording" : "Pause recording"}
          accessibilityState={{ disabled: pauseDisabled }}
          disabled={pauseDisabled}
          onPress={paused ? onResume : onPause}
          style={({ pressed }) => [
            styles.control,
            pressed && styles.pressed,
            pauseDisabled && styles.disabled,
          ]}
        >
          <View style={styles.sideButton}>
            {paused ? (
              <View style={styles.resumeDot} />
            ) : (
              <Ionicons name="pause" size={24} color={Colors.ink} />
            )}
          </View>
          <Text style={styles.label}>{paused ? "Resume" : "Pause"}</Text>
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop and save"
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={onStop}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <View style={styles.stopButton}>
          {saving ? (
            <ActivityIndicator color={Colors.destructiveForeground} />
          ) : (
            <View style={styles.stopIcon} />
          )}
        </View>
        <Text style={[styles.label, styles.stopLabel]}>
          {saving ? "Saving…" : "Stop"}
        </Text>
      </Pressable>
      <View style={styles.spacer} />
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  dock: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 56,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  control: {
    minWidth: SIDE_BUTTON_SIZE,
    alignItems: "center",
    gap: Spacing.sm,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  sideButton: {
    width: SIDE_BUTTON_SIZE,
    height: SIDE_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: SIDE_BUTTON_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    backgroundColor: Colors.mutedSurface,
  },
  resumeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.accent,
  },
  stopButton: {
    width: STOP_BUTTON_SIZE,
    height: STOP_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: STOP_BUTTON_SIZE / 2,
    backgroundColor: Colors.accent,
  },
  stopIcon: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.destructiveForeground,
  },
  label: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
    color: Colors.ink,
  },
  stopLabel: { fontWeight: "600" },
  spacer: { width: SIDE_BUTTON_SIZE },
  wideButton: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.pill,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.primary,
  },
  wideButtonText: {
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
}));
