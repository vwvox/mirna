import { Text } from "react-native";

import { FontFamily } from "@/constants/theme";
import { dayLabel } from "@/data/timeline";
import { useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook } from "@/settings/theme-provider";

import { formatLength, noteLengthMs } from "./mac-progress";
import type { useNoteAudio } from "./use-note-audio";

/** "Today 14:05 · 2 recordings · 50 min", under the note's title. */
export function NoteMeta({
  sessionId,
  createdAt,
  audio,
}: {
  sessionId: string;
  createdAt: string;
  audio: ReturnType<typeof useNoteAudio>;
}) {
  const styles = useStyles();
  const macLink = useMacLinkStatus(sessionId);
  const date = new Date(createdAt);
  const onMac = macLink?.mac_recordings ?? [];
  const lengthMs = audio.data
    ? noteLengthMs({
        filename: audio.data.filename,
        sizeBytes: audio.data.sizeBytes,
        macRecordings: onMac,
        fallbackMs:
          audio.player.duration > 0
            ? audio.player.duration * 1000 +
              onMac.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0)
            : null,
      })
    : null;
  const parts = [
    Number.isFinite(date.getTime())
      ? `${dayLabel(createdAt)} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : null,
    onMac.length > 0 ? `${onMac.length + 1} recordings` : null,
    lengthMs ? formatLength(lengthMs) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <Text style={styles.meta}>{parts.join(" · ")}</Text>;
}

const useStyles = createStyleHook((Colors) => ({
  meta: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
}));
