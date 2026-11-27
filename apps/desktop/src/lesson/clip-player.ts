import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";

import type { ClipRange } from "./clips";

import { routeCentered, shouldResumeBeforePlay } from "~/audio-player/playback";
import { playableBlob } from "~/audio-player/waveform";

let current: {
  audio: HTMLAudioElement;
  timer: number | null;
  id: string | null;
  disconnect: (() => void) | null;
} | null = null;

/** Which clip is playing, by the id its caller gave, so its button can stop it. */
export const usePlayingClip = create<{ id: string | null }>(() => ({
  id: null,
}));

// Recordings are loaded whole, as the note's player does, so Web Audio may
// route them; only the last few lessons are kept, as they run to tens of MB.
const KEEP_RECORDINGS = 2;
const urls = new Map<string, Promise<string | null>>();

async function loadSessionAudio(sessionId: string): Promise<string | null> {
  const result = await fsSyncCommands.audioPath(sessionId);
  if (result.status === "error") return null;
  const url = convertFileSrc(result.data);
  try {
    const response = await fetch(url);
    if (response.ok) {
      const playable = playableBlob(new Audio(), await response.blob(), url);
      if (playable) return URL.createObjectURL(playable);
    }
  } catch {
    // Played straight from the file below, as recorded.
  }
  return url;
}

/**
 * A URL for a note's recording: a same-origin blob when it could be loaded,
 * else the file itself, which plays as recorded.
 */
export function sessionAudioUrl(sessionId: string): Promise<string | null> {
  const cached = urls.get(sessionId);
  if (cached) {
    urls.delete(sessionId);
    urls.set(sessionId, cached);
    return cached;
  }
  const loading = loadSessionAudio(sessionId);
  urls.set(sessionId, loading);
  void loading.then((url) => {
    if (!url && urls.get(sessionId) === loading) urls.delete(sessionId);
  });
  for (const [oldest, old] of urls) {
    if (urls.size <= KEEP_RECORDINGS) break;
    urls.delete(oldest);
    void old.then((url) => {
      if (url?.startsWith("blob:") && current?.audio.src !== url) {
        URL.revokeObjectURL(url);
      }
    });
  }
  return loading;
}

let context: AudioContext | null = null;
let contextUnavailable = false;

/** A running audio context for clips, or null when Web Audio can't play now. */
async function runningContext(): Promise<AudioContext | null> {
  if (!context && !contextUnavailable) {
    try {
      context = new AudioContext();
    } catch {
      contextUnavailable = true;
    }
  }
  if (!context) return null;
  if (shouldResumeBeforePlay(context)) {
    await Promise.race([
      context.resume().catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, 300)),
    ]);
  }
  return context.state === "running" ? context : null;
}

export function stopClip() {
  if (!current) return;
  if (current.timer !== null) window.clearTimeout(current.timer);
  current.audio.pause();
  current.disconnect?.();
  current = null;
  usePlayingClip.setState({ id: null });
}

/**
 * Plays a stretch of a note's recording outside its note, for practice and the
 * course view, in both ears: only the clip's own side of a call recorded on the
 * Mac, so the student's voice doesn't come in over the teacher's. Only one clip
 * plays at a time.
 */
export async function playSessionClip(
  sessionId: string,
  clip: ClipRange,
  playbackRate = 1,
  id: string | null = null,
): Promise<boolean> {
  const url = await sessionAudioUrl(sessionId);
  if (!url) return false;
  stopClip();
  const audio = new Audio(url);
  audio.playbackRate = playbackRate;
  const entry = {
    audio,
    timer: null as number | null,
    id,
    disconnect: null as (() => void) | null,
  };
  current = entry;
  usePlayingClip.setState({ id });
  audio.addEventListener("ended", () => {
    if (current === entry) stopClip();
  });
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("audio")), {
      once: true,
    });
  }).catch(() => null);
  if (current !== entry) return false;
  // A file from another origin would play silent through Web Audio.
  const audioContext = url.startsWith("blob:") ? await runningContext() : null;
  if (current !== entry) return false;
  if (audioContext) {
    try {
      entry.disconnect = routeCentered(
        audioContext,
        audioContext.createMediaElementSource(audio),
        clip.channel ?? null,
      ).disconnect;
    } catch {
      // Plays as recorded.
    }
  }
  audio.currentTime = clip.startMs / 1000;
  try {
    await audio.play();
  } catch {
    if (current === entry) stopClip();
    return false;
  }
  entry.timer = window.setTimeout(
    () => {
      if (current === entry) stopClip();
    },
    Math.max(200, (clip.endMs - clip.startMs) / playbackRate),
  );
  return true;
}
