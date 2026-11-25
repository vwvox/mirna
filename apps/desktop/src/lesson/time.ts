/** "mm:ss", or "h:mm:ss" from an hour on. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${String(minutes).padStart(2, "0")}:${ss}`;
}

/** Reads "mm:ss" or "h:mm:ss" (also with brackets) back into milliseconds. */
export function parseClock(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^\[?(?:(\d+):)?(\d{1,3}):(\d{2})\]?$/u);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (Number(seconds) > 59) return null;
  return (
    (Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
  );
}
