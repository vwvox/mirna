/** Length of the PCM in a recovered WAV. */
export function wavDurationMs(
  dataBytes: number,
  sampleRate: number,
  channels: number,
): number {
  const bytesPerSecond = sampleRate * channels * 2;
  return bytesPerSecond > 0 ? (dataBytes * 1_000) / bytesPerSecond : 0;
}

function savedLength(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1_000))} sec`;
  }
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * The notice when Mirna, on opening, finds a recording that hadn't finished
 * saving and saves it. That happens when Android closed Mirna mid-recording,
 * and also when saving on Stop failed, so it doesn't blame either.
 */
export function recoveryNotice(
  durationsMs: readonly number[],
): { title: string; description: string } | null {
  if (durationsMs.length === 0) return null;
  if (durationsMs.length === 1) {
    return {
      title: "Recording recovered",
      description: `${savedLength(durationsMs[0] ?? 0)} that hadn’t finished saving is safe now.`,
    };
  }
  const total = durationsMs.reduce((sum, ms) => sum + ms, 0);
  return {
    title: "Recordings recovered",
    description: `${durationsMs.length} recordings that hadn’t finished saving, ${savedLength(total)} in all, are safe now.`,
  };
}
