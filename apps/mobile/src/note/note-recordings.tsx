import { View } from "react-native";

import { RecordingRow } from "@/components/audio-chip";
import { CornerCurve, Spacing } from "@/constants/theme";
import { wavDurationMs } from "@/mac-link/model";
import { usePairedMac } from "@/mac-link/pairing";
import { useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook } from "@/settings/theme-provider";

import type { useNoteAudio } from "./use-note-audio";

/**
 * The note's recordings, at the bottom of the note: this phone's, to play,
 * and any added on the Mac, whose audio stays there while their text is here.
 */
export function NoteRecordings({
  sessionId,
  audio,
}: {
  sessionId: string;
  audio: ReturnType<typeof useNoteAudio>;
}) {
  const styles = useStyles();
  const { mac } = usePairedMac();
  const macLink = useMacLinkStatus(sessionId);
  const macName = mac?.mac_name || "your Mac";
  const onMac = macLink?.mac_recordings ?? [];

  if (!audio.data || (!audio.availableLocally && onMac.length === 0)) {
    return null;
  }
  const phoneMs = wavDurationMs(audio.data.filename, audio.data.sizeBytes);
  const phoneSeconds =
    audio.player.duration > 0
      ? audio.player.duration
      : phoneMs !== null
        ? phoneMs / 1000
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
}));
