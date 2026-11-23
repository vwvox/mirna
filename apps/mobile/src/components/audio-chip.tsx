import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import { ControlSize, FontFamily } from "@/constants/theme";
import { captureOperationalError } from "@/lib/error-reporting";
import { formatClock } from "@/note/mac-progress";
import { createStyleHook, useColors } from "@/settings/theme-provider";

/**
 * Plays the note's recording from this phone. One player per note, so the
 * recordings bar and the failed card's "Play it" control the same audio.
 */
export function useRecordingPlayer(uri: string | null) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  // A new recording gets a new player; report its playback errors once each.
  useEffect(() => {
    let lastError: string | null = null;
    const subscription = player.addListener(
      "playbackStatusUpdate",
      (nextStatus) => {
        const errorKey = nextStatus.error
          ? nextStatus.error
          : nextStatus.mediaServicesDidReset
            ? "media_services_reset"
            : null;
        if (!errorKey || errorKey === lastError) return;

        lastError = errorKey;
        captureOperationalError(
          new Error(nextStatus.error ?? "Audio media services reset"),
          {
            operation: nextStatus.mediaServicesDidReset
              ? "audio_playback_media_services_reset"
              : "audio_playback",
            level: nextStatus.mediaServicesDidReset ? "warning" : "error",
          },
        );
      },
    );
    return () => subscription.remove();
  }, [player]);

  const play = async () => {
    if (!uri) return;
    try {
      if (status.duration > 0 && status.currentTime >= status.duration - 0.05) {
        await player.seekTo(0);
      }
      player.play();
    } catch (error) {
      captureOperationalError(error, {
        operation: "audio_playback_control",
      });
    }
  };

  return {
    available: uri !== null,
    playing: status.playing,
    currentTime: status.currentTime,
    /** Seconds; 0 until the file has loaded. */
    duration: status.duration,
    play,
    toggle: async () => {
      if (!status.playing) return play();
      try {
        player.pause();
      } catch (error) {
        captureOperationalError(error, {
          operation: "audio_playback_control",
        });
      }
    },
  };
}

export type RecordingPlayer = ReturnType<typeof useRecordingPlayer>;

/**
 * One recording in the note's recordings bar: this phone's, with play, or one
 * added on the Mac, whose audio stays there.
 */
export function RecordingRow({
  title,
  detail,
  durationSeconds,
  player,
  kind,
}: {
  title: string;
  detail?: string;
  durationSeconds: number | null;
  /** Only for this phone's recording. */
  player?: RecordingPlayer;
  kind: "phone" | "mac" | "missing";
}) {
  const styles = useStyles();
  const Colors = useColors();
  const playing = player?.playing ?? false;
  const total =
    durationSeconds && durationSeconds > 0
      ? formatClock(durationSeconds)
      : null;
  const time =
    player && (playing || player.currentTime > 0)
      ? `${formatClock(player.currentTime)}${total ? ` / ${total}` : ""}`
      : total;

  return (
    <View style={styles.row}>
      {kind === "phone" && player ? (
        <Pressable
          accessibilityLabel={`${playing ? "Pause" : "Play"} ${title.toLowerCase()}`}
          accessibilityRole="button"
          onPress={() => void player.toggle()}
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}
        >
          <Ionicons
            name={playing ? "pause" : "play"}
            size={20}
            color={Colors.primaryForeground}
            style={!playing && styles.playGlyph}
          />
        </Pressable>
      ) : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.badge}
        >
          <Ionicons
            name={kind === "mac" ? "laptop-outline" : "cloud-offline-outline"}
            size={20}
            color={Colors.muted}
          />
        </View>
      )}
      <View
        accessible
        accessibilityLabel={[title, detail, total].filter(Boolean).join(", ")}
        style={styles.copy}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
  },
  play: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ControlSize.default / 2,
    backgroundColor: Colors.primary,
  },
  playGlyph: { marginLeft: 2 },
  pressed: { opacity: 0.7 },
  badge: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ControlSize.default / 2,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.mutedSurface,
  },
  copy: { flex: 1, gap: 1 },
  title: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.ink,
  },
  detail: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
  time: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
}));
