import type { EditorView } from "~/store/zustand/tabs/schema";

export function shouldShowSessionTopAudioPlayer({
  audioExists,
  audioUrlReady,
  currentView,
  sessionMode,
}: {
  audioExists: boolean;
  audioUrlReady: boolean;
  currentView: EditorView;
  sessionMode: string;
}) {
  return (
    // The study sheet plays the teacher's clips through this player.
    (currentView.type === "transcript" || currentView.type === "lesson") &&
    audioExists &&
    audioUrlReady &&
    sessionMode !== "active" &&
    sessionMode !== "finalizing"
  );
}
