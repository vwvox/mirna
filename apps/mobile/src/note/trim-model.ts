// Cutting the end off a recording that ran too long: the choices offered, and
// where the talking seems to stop. Pure, so node's test runner can run it.

/** The quick choices, in minutes cut from the end. */
export const TRIM_MINUTES = [5, 10, 15, 30, 60] as const;

/** At least this much of a recording is always kept. */
export const MIN_KEEP_MS = 30_000;

export type TrimChoice = { minutes: number; keepMs: number };

/** The quick choices that leave enough of this recording. */
export function trimChoices(lengthMs: number): TrimChoice[] {
  return TRIM_MINUTES.map((minutes) => ({
    minutes,
    keepMs: lengthMs - minutes * 60_000,
  })).filter((choice) => choice.keepMs >= MIN_KEEP_MS);
}

/** Keeps a cut between the minimum and the whole recording, to the second. */
export function clampKeep(keepMs: number, lengthMs: number): number {
  const rounded = Math.round(keepMs / 1000) * 1000;
  return Math.min(lengthMs, Math.max(Math.min(MIN_KEEP_MS, lengthMs), rounded));
}

/** How loud each sample of the recording was: RMS of 16-bit PCM, 0 to 1. */
export function pcmRms(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(index * 2, true) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

/** A sample counts as talking well above the recording's own quiet level. */
const SPEECH_OVER_FLOOR = 4;
const SPEECH_MIN_RMS = 0.01;
/** Only suggest a cut when the quiet at the end is at least this long. */
const MIN_TRAILING_QUIET_MS = 3 * 60_000;
/** Room left after the last talking, so the last words aren't clipped. */
const SUGGESTION_PAD_MS = 30_000;

/**
 * Where to cut when the recording ends in a long quiet stretch: shortly after
 * the last stretch of talking. `levels` are evenly spaced across the
 * recording. Returns the length to keep, or null when there's nothing to
 * suggest.
 */
export function suggestKeep(levels: number[], lengthMs: number): number | null {
  if (levels.length < 10 || lengthMs <= MIN_KEEP_MS) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.max(SPEECH_MIN_RMS, floor * SPEECH_OVER_FLOOR);
  const stepMs = lengthMs / levels.length;
  // Talking is a few loud samples close together, not one bump.
  let lastTalk = -1;
  const loud = (index: number) => (levels[index] ?? 0) >= threshold;
  for (let index = levels.length - 1; index >= 2; index -= 1) {
    if (loud(index) && (loud(index - 1) || loud(index - 2))) {
      lastTalk = index;
      break;
    }
  }
  if (lastTalk < 0) return null;
  const talkEndsMs = (lastTalk + 1) * stepMs;
  if (lengthMs - talkEndsMs < MIN_TRAILING_QUIET_MS) return null;
  return clampKeep(talkEndsMs + SUGGESTION_PAD_MS, lengthMs);
}

/** "1 h 02 min", "12 min", "45 s". */
export function formatLength(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

/** "1:02:05", for the cut point on the slider. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(hours > 0 ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
