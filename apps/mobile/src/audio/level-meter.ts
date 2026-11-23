/** Bars in the recording screen's level strip. */
export const LEVEL_BAR_COUNT = 40;

const FLOOR_DB = -48;

/** A buffer's peak (0 to 1) on a 0-to-1 scale that follows loudness, not voltage. */
export function levelFromAmplitude(peak: number): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

/** The newest level goes last; the oldest falls off the start. */
export function pushLevel(
  levels: readonly number[],
  level: number,
  count: number = LEVEL_BAR_COUNT,
): number[] {
  const next = levels.length >= count ? levels.slice(levels.length - count + 1) : [...levels];
  next.push(level);
  return next;
}
