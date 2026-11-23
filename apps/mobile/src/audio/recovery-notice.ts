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
 * The notice after Android closed Mirna mid-recording and the next launch
 * saved what was recorded.
 */
export function recoveryNotice(
  durationsMs: readonly number[],
): { title: string; description: string } | null {
  if (durationsMs.length === 0) return null;
  if (durationsMs.length === 1) {
    return {
      title: "Recording stopped",
      description: `Android closed Mirna. ${savedLength(durationsMs[0] ?? 0)} was saved.`,
    };
  }
  const total = durationsMs.reduce((sum, ms) => sum + ms, 0);
  return {
    title: "Recordings stopped",
    description: `Android closed Mirna. ${durationsMs.length} recordings, ${savedLength(total)} in all, were saved.`,
  };
}
