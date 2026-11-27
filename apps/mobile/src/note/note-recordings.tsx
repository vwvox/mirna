import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { RecordingRow } from "@/components/audio-chip";
import {
  ControlSize,
  CornerCurve,
  FontFamily,
  Spacing,
} from "@/constants/theme";
import { wavDurationMs } from "@/mac-link/model";
import { usePairedMac } from "@/mac-link/pairing";
import { useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import type { useNoteAudio } from "./use-note-audio";

/**
 * The note's recordings, at the bottom of the note: this phone's, to play,
 * and any added on the Mac, whose audio stays there while their text is here.
 */
export function NoteRecordings({
  sessionId,
  audio,
  onRecordMore,
}: {
  sessionId: string;
  audio: ReturnType<typeof useNoteAudio>;
  /** Records onto the end of this phone's recording, when it can. */
  onRecordMore?: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const { mac } = usePairedMac();
  const macLink = useMacLinkStatus(sessionId);
  const macName = mac?.mac_name || "your Mac";
  const onMac = macLink?.mac_recordings ?? [];

  if (!audio.data || (!audio.availableLocally && onMac.length === 0)) {
    return null;
  }
  const phoneMs = wavDurationMs(audio.data.filename, audio.data.sizeBytes);
  // A WAV's length follows from its size, which stays right after a trim; the
  // player keeps the length it loaded first.
  const phoneSeconds =
    phoneMs !== null
      ? phoneMs / 1000
      : audio.player.duration > 0
        ? audio.player.duration
        : null;
  const several = onMac.length > 0;

  return (
    <View
      accessibilityLabel="Recordings"
      style={[styles.card, several && styles.list]}
    >
      <RecordingRow
        kind={audio.availableLocally ? "phone" : "missing"}
        title={several ? "Recording 1" : "Recording"}
        detail={
          several
            ? audio.availableLocally
              ? "On this phone"
              : "Not on this phone"
            : undefined
        }
        durationSeconds={phoneSeconds}
        player={audio.availableLocally ? audio.player : undefined}
      />
      {onMac.map((recording, index) => (
        <View key={recording.id} style={styles.divided}>
          <RecordingRow
            kind="mac"
            title={`Recording ${index + 2}`}
            detail={`Audio stays on ${macName} · text is here`}
            durationSeconds={
              recording.duration_ms ? recording.duration_ms / 1000 : null
            }
          />
        </View>
      ))}
      {onRecordMore && (
        <Pressable
          accessibilityHint="Continues the recording, adding to its end"
          accessibilityLabel="Record more"
          accessibilityRole="button"
          onPress={onRecordMore}
          style={({ pressed }) => [
            styles.divided,
            styles.more,
            pressed && styles.morePressed,
          ]}
        >
          <View style={styles.moreIcon}>
            <Ionicons name="mic-outline" size={20} color={Colors.primary} />
          </View>
          <View style={styles.moreCopy}>
            <Text style={styles.moreTitle}>Record more</Text>
            <Text style={styles.moreDetail}>
              Continues this recording
              {mac ? ` · ${macName} updates the note` : ""}
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  card: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 30,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  list: { borderRadius: 20 },
  divided: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: ControlSize.default + 16,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
  },
  morePressed: { backgroundColor: Colors.accentSurface },
  moreIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ControlSize.default / 2,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.accentSurface,
  },
  moreCopy: { flex: 1, gap: 1 },
  moreTitle: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: Colors.primary,
  },
  moreDetail: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
}));
