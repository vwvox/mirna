import { createContext, useContext, type ReactNode } from "react";

import { useSessionRecorder } from "@/audio/use-session-recorder";

export type Recorder = ReturnType<typeof useSessionRecorder>;

const RecorderContext = createContext<Recorder | null>(null);

/**
 * Holds the app's recorder above the screens, so going back to the notes
 * (or opening another note) keeps a recording going.
 */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const recorder = useSessionRecorder();
  return (
    <RecorderContext.Provider value={recorder}>
      {children}
    </RecorderContext.Provider>
  );
}

export function useRecorder(): Recorder {
  const recorder = useContext(RecorderContext);
  if (!recorder) throw new Error("useRecorder needs a RecorderProvider");
  return recorder;
}

/**
 * Whether the recorder has this note's audio in hand: recording, paused,
 * saving, or holding audio it couldn't save yet.
 */
export function isRecordingInto(recorder: Recorder, sessionId: string) {
  return (
    recorder.sessionId === sessionId &&
    recorder.phase !== "idle" &&
    recorder.phase !== "saved"
  );
}

/** A recording is going somewhere in the app (what the notes list shows). */
export function hasRecordingInProgress(recorder: Recorder) {
  return (
    recorder.sessionId !== null &&
    ["starting", "recording", "paused", "saving", "save_error"].includes(
      recorder.phase,
    )
  );
}
