import { create } from "zustand";

export type SheetClip = { key: string; startSec: number; endSec: number };

/** The clip the study sheet last started, so its button can pause and resume it. */
export const useSheetClip = create<{ active: SheetClip | null }>(() => ({
  active: null,
}));

type Player = {
  state: "playing" | "paused" | "stopped";
  currentTime: () => number | null;
  pause: () => void;
  playRange: (startSec: number, endSec: number) => void;
};

/**
 * One button per clip: it pauses its clip while that plays, carries on from where
 * it paused, and otherwise starts the clip from the top.
 */
export function toggleSheetClip(player: Player, clip: SheetClip) {
  const active = useSheetClip.getState().active;
  if (active?.key === clip.key) {
    if (player.state === "playing") {
      player.pause();
      return;
    }
    const at = player.currentTime();
    if (
      player.state === "paused" &&
      at !== null &&
      at > active.startSec &&
      at < active.endSec - 0.15
    ) {
      player.playRange(at, active.endSec);
      return;
    }
  }
  useSheetClip.setState({ active: clip });
  player.playRange(clip.startSec, clip.endSec);
}

/** Forgets the clip once playback wanders off it, such as with the main player. */
export function trackSheetClip(timeSec: number, playing: boolean) {
  const active = useSheetClip.getState().active;
  if (!active || !playing) return;
  if (timeSec < active.startSec - 0.5 || timeSec > active.endSec + 0.5) {
    useSheetClip.setState({ active: null });
  }
}
