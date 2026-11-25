import { configureCenteredPlayback, shouldResumeBeforePlay } from "./playback";
import { playableBlob } from "./waveform";

export type ClipPlayer = {
  play: (fromMs: number, toMs: number) => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

/**
 * Plays short stretches of a recording on its own, apart from the note's
 * player, which only exists while the transcript is shown.
 */
export async function createClipPlayer(
  url: string,
  onPlayingChange: (playing: boolean) => void,
): Promise<ClipPlayer> {
  const response = await fetch(url);
  if (response.status >= 400) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const blob = await response.blob();

  const media = new Audio();
  media.crossOrigin = "anonymous";
  media.preload = "auto";
  const playable = playableBlob(media, blob, url);
  const src = playable ? URL.createObjectURL(playable) : url;
  media.src = src;
  const context = configureCenteredPlayback(media);

  let stopAtSeconds = Infinity;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };
  // timeupdate fires only every ~250 ms; poll so the clip stops on its end.
  media.addEventListener("play", () => {
    stopTimer();
    timer = setInterval(() => {
      if (media.currentTime >= stopAtSeconds) media.pause();
    }, 50);
    onPlayingChange(true);
  });
  const stopped = () => {
    stopTimer();
    onPlayingChange(false);
  };
  media.addEventListener("pause", stopped);
  media.addEventListener("ended", stopped);

  const dispose = () => {
    stopTimer();
    media.pause();
    media.removeAttribute("src");
    media.load();
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    void context?.close().catch(() => {});
  };

  try {
    await new Promise<void>((resolve, reject) => {
      if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      media.addEventListener("loadedmetadata", () => resolve(), {
        once: true,
      });
      media.addEventListener(
        "error",
        () => reject(new Error("audio_unplayable")),
        { once: true },
      );
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    async play(fromMs, toMs) {
      stopAtSeconds = toMs / 1000;
      media.currentTime = fromMs / 1000;
      if (shouldResumeBeforePlay(context)) await context.resume();
      await media.play();
    },
    stop: () => media.pause(),
    dispose,
  };
}
