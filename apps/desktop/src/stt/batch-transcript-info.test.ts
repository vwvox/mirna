import { describe, expect, it } from "vitest";

import { batchTranscriptInfo } from "./batch-transcript-info";

describe("batchTranscriptInfo", () => {
  it("reads the routed engine, language and echo removed", () => {
    const info = batchTranscriptInfo({
      metadata: {
        duration: 477,
        soniqo_routing: {
          requested_model: "soniqo-parakeet-batch",
          model: "soniqo-qwen3-small",
          language: "zh",
          qwen3_suggested: false,
        },
        mic_echo: { removed_seconds: 7.7, mic_speech_seconds: 43.2 },
      },
    });

    expect(info).toEqual({
      model: "soniqo-qwen3-small",
      language: "zh",
      metadata: {
        engine: {
          requested_model: "soniqo-parakeet-batch",
          model: "soniqo-qwen3-small",
          language: "zh",
          qwen3_suggested: false,
        },
        mic_echo: { removed_seconds: 7.7, mic_speech_seconds: 43.2 },
      },
    });
  });

  it("returns nothing for engines that don't report it", () => {
    expect(batchTranscriptInfo({ metadata: { duration: 3 } })).toBeUndefined();
    expect(batchTranscriptInfo({})).toBeUndefined();
    expect(batchTranscriptInfo({ metadata: [1] })).toBeUndefined();
  });

  it("keeps the echo report without routing", () => {
    expect(
      batchTranscriptInfo({ metadata: { mic_echo: { removed_seconds: 2 } } }),
    ).toEqual({
      model: undefined,
      language: undefined,
      metadata: { mic_echo: { removed_seconds: 2 } },
    });
  });
});
