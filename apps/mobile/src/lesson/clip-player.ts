import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";

import { captureOperationalError } from "@/lib/error-reporting";
import { clipUri, useClipsVersion } from "@/mac-link/lessons";

import type { ReviewClip } from "./review-plan";

/**
 * Plays a lesson's teacher clips from this phone's copies, one at a time.
 * Clips the Mac hasn't sent yet just aren't offered.
 */
export function useClipPlayer(sessionId: string) {
  // New clips arriving show their buttons.
  useClipsVersion();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

  const play = (clip: ReviewClip) => {
    const uri = clipUri(sessionId, clip.id);
    if (!uri) return;
    try {
      if (current === clip.id) {
        void player.seekTo(0).then(() => player.play());
      } else {
        player.replace({ uri });
        player.play();
        setCurrent(clip.id);
      }
    } catch (error) {
      captureOperationalError(error, { operation: "lesson_clip_playback" });
    }
  };

  return {
    play,
    stop: () => {
      try {
        if (status.playing) player.pause();
      } catch (error) {
        captureOperationalError(error, { operation: "lesson_clip_playback" });
      }
    },
    /** The clip playing now, if any. */
    playing: status.playing ? current : null,
    has: (clip: ReviewClip | null | undefined): clip is ReviewClip =>
      Boolean(clip && clipUri(sessionId, clip.id)),
  };
}

export type ClipPlayer = ReturnType<typeof useClipPlayer>;
