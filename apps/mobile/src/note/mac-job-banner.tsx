import { useMutation } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { CornerCurve, Radius, Spacing, Typography } from "@/constants/theme";
import { usePairedMac } from "@/mac-link/pairing";
import { retryRecordingOnMac } from "@/mac-link/sender";
import { useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

/**
 * While the Mac works on a note again (transcribing it again, or trimming
 * it), one line saying so; and what went wrong if it couldn't.
 */
export function MacJobBanner({ sessionId }: { sessionId: string }) {
  const styles = useStyles();
  const Colors = useColors();
  const status = useMacLinkStatus(sessionId);
  const { mac } = usePairedMac();
  const retry = useMutation({
    mutationFn: () => retryRecordingOnMac(sessionId),
  });
  if (!status?.job || !mac) return null;
  const macName = mac.mac_name || "your Mac";

  if (status.state === "failed") {
    return (
      <View style={[styles.banner, styles.failed]}>
        <Text style={styles.text}>
          {status.error ??
            (status.job === "trim"
              ? `${macName} couldn't trim this recording.`
              : `${macName} couldn't transcribe this again.`)}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={retry.isPending}
          onPress={() => retry.mutate()}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>
            {retry.isPending ? "Trying…" : "Try again"}
          </Text>
        </Pressable>
      </View>
    );
  }

  const text =
    status.state === "summarizing"
      ? `Writing the summary again on ${macName}…`
      : status.state === "on_mac"
        ? `Waiting for ${macName}…`
        : status.job === "trim"
          ? `Trimming on ${macName}…`
          : `Transcribing again on ${macName}…`;
  if (!["on_mac", "transcribing", "summarizing"].includes(status.state)) {
    return null;
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      <ActivityIndicator size="small" color={Colors.primary} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
  },
  failed: { backgroundColor: Colors.alert },
  text: { ...Typography.caption, color: Colors.ink, flex: 1 },
  action: { paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  actionLabel: { ...Typography.captionStrong, color: Colors.primary },
  pressed: { opacity: 0.6 },
}));
