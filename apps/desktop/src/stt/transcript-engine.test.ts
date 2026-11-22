import { describe, expect, it } from "vitest";

import { languageName, summarizeTranscriptEngine } from "./transcript-engine";

const row = (overrides: Record<string, string | null> = {}) => ({
  provider: "soniqo",
  model: "soniqo-parakeet-batch",
  language: "",
  metadata_json: "{}",
  ...overrides,
});

describe("summarizeTranscriptEngine", () => {
  it("names the on-device engine that wrote the transcript", () => {
    expect(summarizeTranscriptEngine([row()])).toEqual({
      engine: { label: "Parakeet", local: true },
      language: undefined,
      reroutedFrom: undefined,
      qwen3Suggested: false,
      echoRemovedSeconds: 0,
    });
  });

  it("says when the language heard switched engines", () => {
    const summary = summarizeTranscriptEngine([
      row({
        model: "soniqo-qwen3-small",
        language: "zh",
        metadata_json: JSON.stringify({
          engine: {
            requested_model: "soniqo-parakeet-batch",
            model: "soniqo-qwen3-small",
          },
          mic_echo: { removed_seconds: 7.7 },
        }),
      }),
    ]);
    expect(summary?.engine.label).toBe("Qwen3-ASR");
    expect(summary?.reroutedFrom?.label).toBe("Parakeet");
    expect(summary?.language).toBe("zh");
    expect(summary?.echoRemovedSeconds).toBe(7.7);
  });

  it("adds up echo across captures and flags a missing Qwen3-ASR", () => {
    const summary = summarizeTranscriptEngine([
      row({
        metadata_json: JSON.stringify({
          engine: { qwen3_suggested: true },
          mic_echo: { removed_seconds: 3 },
        }),
      }),
      row({
        metadata_json: JSON.stringify({ mic_echo: { removed_seconds: 2.5 } }),
      }),
      row({ metadata_json: "not json" }),
    ]);
    expect(summary?.qwen3Suggested).toBe(true);
    expect(summary?.echoRemovedSeconds).toBe(5.5);
  });

  it("shows nothing without a batch transcript", () => {
    expect(summarizeTranscriptEngine([])).toBeNull();
    expect(summarizeTranscriptEngine([row({ provider: null })])).toBeNull();
  });
});

describe("languageName", () => {
  it("names languages in the app's language", () => {
    expect(languageName("zh", "en")).toBe("Chinese");
    expect(languageName("pt", "en")).toBe("Portuguese");
  });
});
