/** How a batch transcript was made, read from the engine's response. */
export type BatchTranscriptInfo = {
  /** The engine that actually transcribed, when Mirna rerouted the recording. */
  model?: string;
  /** Base language code the engine detected, e.g. "zh". */
  language?: string;
  /** Saved with the transcript: `engine` (routing) and `mic_echo` (echo removed). */
  metadata: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function batchTranscriptInfo(response: {
  metadata?: unknown;
}): BatchTranscriptInfo | undefined {
  const metadata = response.metadata;
  if (!isRecord(metadata)) return undefined;
  const routing = isRecord(metadata.soniqo_routing)
    ? metadata.soniqo_routing
    : undefined;
  const echo = isRecord(metadata.mic_echo) ? metadata.mic_echo : undefined;
  if (!routing && !echo) return undefined;

  return {
    model: typeof routing?.model === "string" ? routing.model : undefined,
    language:
      typeof routing?.language === "string" ? routing.language : undefined,
    metadata: {
      ...(routing ? { engine: routing } : {}),
      ...(echo ? { mic_echo: echo } : {}),
    },
  };
}
