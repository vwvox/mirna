import { View } from "react-native";

import { RecordingSyncCard } from "@/components/recording-sync-card";
import { RemoteAudioCard } from "@/components/remote-audio-card";
import { Spacing } from "@/constants/theme";

import { noteLengthMs } from "./mac-progress";
import type { useNoteAudio } from "./use-note-audio";

type NoteAudio = ReturnType<typeof useNoteAudio>;

/** This phone's recording, for the progress card's first step. */
export function savedRecording(audio: NoteAudio) {
  return {
    lengthMs: noteLengthMs({
      filename: audio.data?.filename,
      sizeBytes: audio.data?.sizeBytes,
      fallbackMs:
        audio.player.duration > 0 ? audio.player.duration * 1000 : null,
    }),
    sizeBytes: audio.data?.sizeBytes ?? null,
  };
}

// Below the transcript: where the recording is while the Mac transcribes it,
// and a way to get it back when it isn't on this phone. Playback is in the
// note's recordings bar.
export function RecordingDetails({
  sessionId,
  audio,
  hasTranscript,
}: {
  sessionId: string;
  audio: NoteAudio;
  hasTranscript?: boolean | undefined;
}) {
  if (!audio.data) return null;
  return (
    <View style={{ gap: Spacing.md, marginTop: Spacing.md }}>
      {hasTranscript !== true && (
        <RecordingSyncCard
          sessionId={sessionId}
          saved={savedRecording(audio)}
          onPlay={
            audio.player.available ? () => void audio.player.play() : undefined
          }
        />
      )}
      {!audio.availableLocally && <RemoteAudioCard {...audio.restore} />}
    </View>
  );
}
