// Cutting the end off a recording that ran on: the choices offered and where
// the talking stops. Same rules as the phone's Trim sheet
// (apps/mobile/src/note/trim-model.ts), so both apps suggest the same cuts.

/** The quick choices, in minutes cut from the end. */
export const TRIM_MINUTES = [5, 10, 15, 30, 60] as const;

/** At least this much of a recording is always kept. */
export const MIN_KEEP_MS = 30_000;

/** Less than this isn't worth a cut (and the engine refuses it). */
export const MIN_CUT_MS = 1_000;

/** Only suggest a cut when the quiet at the end is at least this long. */
const MIN_TRAILING_QUIET_MS = 3 * 60_000;
/** Room left after the last words, so they aren't clipped. */
const SUGGESTION_PAD_MS = 30_000;

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

/** When the last word ends, in ms from the start of the recording. */
export function lastWordEndMs(
  words: ReadonlyArray<{ end_ms?: number }>,
): number | null {
  let last: number | null = null;
  for (const { end_ms: end } of words) {
    if (
      end !== undefined &&
      Number.isFinite(end) &&
      (last === null || end > last)
    ) {
      last = end;
    }
  }
  return last;
}

export type TrimSuggestion = { talkEndsMs: number; keepMs: number };

/**
 * Where to end a recording whose talking stopped long before it did: shortly
 * after the last words. Null when the talking goes on to (nearly) the end.
 */
export function suggestKeep(
  talkEndsMs: number | null,
  lengthMs: number,
): TrimSuggestion | null {
  if (talkEndsMs === null || lengthMs <= MIN_KEEP_MS) return null;
  if (lengthMs - talkEndsMs < MIN_TRAILING_QUIET_MS) return null;
  return {
    talkEndsMs,
    keepMs: clampKeep(talkEndsMs + SUGGESTION_PAD_MS, lengthMs),
  };
}

export type TrimBlocker = "too_short" | "several_parts" | "from_phone";

/** Why this note's recording can't be trimmed on this Mac, if it can't. */
export function trimBlocker({
  lengthMs,
  transcriptCount,
  fromPhone,
}: {
  lengthMs: number;
  transcriptCount: number;
  fromPhone: boolean;
}): TrimBlocker | null {
  // Words of a second recording count from its own start, not the file's.
  if (transcriptCount > 1) return "several_parts";
  // The phone cuts the Mac's copy first, so both stay the same.
  if (fromPhone) return "from_phone";
  if (lengthMs - MIN_KEEP_MS < MIN_CUT_MS) return "too_short";
  return null;
}

/**
 * Bar heights from 0.06 to 1 for the recording's waveform peaks: channels
 * merged, then the loudest moment in each bar, scaled so quiet talk shows.
 */
export function waveformBars(
  channels: ReadonlyArray<ReadonlyArray<number>>,
  count: number,
): number[] {
  const length = channels.reduce(
    (longest, channel) => Math.max(longest, channel.length),
    0,
  );
  if (length === 0 || count <= 0) return [];
  const perBar = length / count;
  const values = Array.from({ length: count }, (_, bar) => {
    const from = Math.floor(bar * perBar);
    const to = Math.min(
      length,
      Math.max(from + 1, Math.floor((bar + 1) * perBar)),
    );
    let loudest = 0;
    for (let index = from; index < to; index += 1) {
      for (const channel of channels) {
        loudest = Math.max(loudest, channel[index] ?? 0);
      }
    }
    return loudest;
  });
  const peak = Math.max(...values, 0.0001);
  return values.map((value) => Math.max(0.06, Math.sqrt(value / peak)));
}

/** A length in seconds when under a minute, otherwise in hours and minutes. */
export function lengthParts(
  ms: number,
): { seconds: number } | { hours: number; minutes: number } {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return { seconds: totalSeconds };
  const totalMinutes = Math.round(totalSeconds / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
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
