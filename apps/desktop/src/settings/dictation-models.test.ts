import { describe, expect, it, vi } from "vitest";

vi.mock("~/settings/ai/llm/select", () => ({ useConfiguredMapping: vi.fn() }));
vi.mock("~/settings/ai/stt/select", () => ({ useConfiguredMapping: vi.fn() }));
vi.mock("~/settings/ai/llm/shared", () => ({ PROVIDERS: [] }));
vi.mock("~/settings/ai/stt/shared", () => ({
  PROVIDERS: [],
  displayModelLabel: (model: string, displayName?: string) =>
    displayName ?? model,
}));
vi.mock("~/settings/queries", () => ({ setSettingValues: vi.fn() }));

import { dictationSttOptions } from "./dictation-models";

describe("dictation speech model options", () => {
  it("offers configured, downloaded, current models and never a BYO model file", () => {
    const providers = [
      { id: "soniqo", displayName: "Soniqo" },
      { id: "deepgram", displayName: "Deepgram" },
      { id: "local_file", displayName: "BYO-model" },
      { id: "groq", displayName: "Groq" },
    ];
    const options = dictationSttOptions(providers, {
      soniqo: {
        configured: true,
        models: [
          {
            id: "soniqo-parakeet-streaming",
            isDownloaded: true,
            displayName: "Parakeet (live)",
          },
          { id: "soniqo-parakeet-batch", isDownloaded: false },
        ],
      },
      deepgram: {
        configured: true,
        models: [
          { id: "nova-3-general", isDownloaded: true },
          { id: "nova-2", isDownloaded: true, isDeprecated: true },
        ],
      },
      local_file: {
        configured: true,
        models: [{ id: "local-file", isDownloaded: true }],
      },
      groq: { configured: false, models: [] },
    });

    expect(options).toEqual([
      {
        provider: "soniqo",
        providerName: "Soniqo",
        model: "soniqo-parakeet-streaming",
        label: "Parakeet (live)",
      },
      {
        provider: "deepgram",
        providerName: "Deepgram",
        model: "nova-3-general",
        label: "nova-3-general",
      },
    ]);
  });
});
