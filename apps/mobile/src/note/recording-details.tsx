import { AudioChip } from "@/components/audio-chip";
import { RecordingSyncCard } from "@/components/recording-sync-card";
import { RemoteAudioCard } from "@/components/remote-audio-card";

import type { useNoteAudio } from "./use-note-audio";

// The recording itself, and where it is on its way to the Mac. Transcription
// and the summary happen on the Mac and come back to this note.
export function RecordingDetails({
  sessionId,
  audio,
}: {
  sessionId: string;
  audio: ReturnType<typeof useNoteAudio>;
  hasTranscript?: boolean | undefined;
}) {
  return (
    <>
      {audio.data && audio.availableLocally && audio.file && (
        <>
          <AudioChip
            key={`${audio.data.filename}:${audio.data.createdAt}`}
            uri={audio.file.uri}
            filename={audio.data.filename}
            sizeBytes={audio.data.sizeBytes}
          />
          <RecordingSyncCard sessionId={sessionId} />
        </>
      )}
      {audio.data && !audio.availableLocally && (
        <RemoteAudioCard {...audio.restore} />
      )}
    </>
  );
}
