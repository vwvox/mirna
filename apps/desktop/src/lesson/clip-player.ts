import { convertFileSrc } from "@tauri-apps/api/core";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";

let current: { audio: HTMLAudioElement; timer: number | null } | null = null;
const urls = new Map<string, string>();

export async function sessionAudioUrl(
  sessionId: string,
): Promise<string | null> {
  const cached = urls.get(sessionId);
  if (cached) return cached;
  const result = await fsSyncCommands.audioPath(sessionId);
  if (result.status === "error") return null;
  const url = convertFileSrc(result.data);
  urls.set(sessionId, url);
  return url;
}

export function stopClip() {
  if (!current) return;
  if (current.timer !== null) window.clearTimeout(current.timer);
  current.audio.pause();
  current = null;
}

/**
 * Plays a stretch of a note's recording outside its note, for practice and the course
 * view. Only one clip plays at a time.
 */
export async function playSessionClip(
  sessionId: string,
  startMs: number,
  endMs: number,
  playbackRate = 1,
): Promise<boolean> {
  const url = await sessionAudioUrl(sessionId);
  if (!url) return false;
  stopClip();
  const audio = new Audio(url);
  audio.playbackRate = playbackRate;
  const entry = { audio, timer: null as number | null };
  current = entry;
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("audio")), {
      once: true,
    });
  }).catch(() => null);
  if (current !== entry) return false;
  audio.currentTime = startMs / 1000;
  try {
    await audio.play();
  } catch {
    return false;
  }
  entry.timer = window.setTimeout(
    () => {
      if (current === entry) stopClip();
    },
    Math.max(200, (endMs - startMs) / playbackRate),
  );
  return true;
}
