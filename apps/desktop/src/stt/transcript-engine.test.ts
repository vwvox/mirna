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
      hasChinese: false,
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

  describe("unsure language", () => {
    const parakeet = (engine: Record<string, unknown>, model?: string) =>
      summarizeTranscriptEngine([
        row({
          ...(model ? { model } : {}),
          metadata_json: JSON.stringify({ engine }),
        }),
      ])?.unsureLanguages;
    const guess = (
      code: string,
      probability: number,
      parakeetKnows = true,
    ) => ({
      code,
      probability,
      parakeet_knows: parakeetKnows,
    });

    it("lists the languages when Chinese was mixed into English", () => {
      // What a Chinese lesson taught in English measured.
      expect(
        parakeet({
          predictions_by_channel: [
            [
              guess("en", 0.604),
              guess("zh", 0.251, false),
              guess("ko", 0.074, false),
            ],
          ],
        }),
      ).toEqual([
        { code: "en", probability: 0.604 },
        { code: "zh", probability: 0.251 },
      ]);
    });

    it("reads older transcripts that kept only the top guess", () => {
      expect(
        parakeet({ languages_by_channel: [{ code: "en", probability: 0.59 }] }),
      ).toEqual([{ code: "en", probability: 0.59 }]);
    });

    it("flags a language Parakeet doesn't know even behind a sure guess", () => {
      expect(
        parakeet({
          predictions_by_channel: [
            [guess("en", 0.85), guess("zh", 0.12, false), guess("de", 0.01)],
          ],
        }),
      ).toEqual([
        { code: "en", probability: 0.85 },
        { code: "zh", probability: 0.12 },
      ]);
    });

    it("merges channels, keeping each language's likeliest share", () => {
      expect(
        parakeet({
          predictions_by_channel: [
            [guess("en", 0.95), guess("cy", 0.03, false)],
            [],
            [guess("en", 0.6), guess("pt", 0.3), guess("es", 0.05)],
          ],
        }),
      ).toEqual([
        { code: "en", probability: 0.95 },
        { code: "pt", probability: 0.3 },
      ]);
    });

    it("stays quiet when the language was clear", () => {
      // English-only recordings: stray Welsh and Latin far behind.
      expect(
        parakeet({
          predictions_by_channel: [
            [
              guess("en", 0.928),
              guess("cy", 0.027, false),
              guess("la", 0.01, false),
            ],
          ],
          languages_by_channel: [{ code: "en", probability: 0.928 }],
        }),
      ).toBeUndefined();
      expect(
        parakeet({
          languages_by_channel: [{ code: "en", probability: 0.99 }, null],
        }),
      ).toBeUndefined();
      expect(parakeet({ predictions_by_channel: [[], []] })).toBeUndefined();
      expect(parakeet({})).toBeUndefined();
    });

    it("leaves it to the Qwen3-ASR suggestion, or to other engines", () => {
      const unsure = {
        predictions_by_channel: [[guess("en", 0.5), guess("zh", 0.4, false)]],
      };
      expect(parakeet({ ...unsure, qwen3_suggested: true })).toBeUndefined();
      expect(parakeet(unsure, "soniqo-qwen3-small")).toBeUndefined();
    });
  });

  it("knows when the transcript has Chinese", () => {
    expect(
      summarizeTranscriptEngine([row({ has_han: 1 } as never)])?.hasChinese,
    ).toBe(true);
    expect(
      summarizeTranscriptEngine([row({ language: "zh" })])?.hasChinese,
    ).toBe(true);
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
