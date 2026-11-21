import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  provider: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.settings,
}));
vi.mock("~/settings/providers", () => ({
  getStoredAiProvider: mocks.provider,
}));
vi.mock("./provider-fetch", () => ({ providerFetch: mocks.fetch }));

import { ollamaWarmupRequest, warmLocalLlm } from "./local-llm-warmup";

describe("warmLocalLlm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(new Response("{}"));
  });

  it("preloads the selected Ollama model with a bounded keep-alive", async () => {
    mocks.settings.mockResolvedValue({
      values: {
        current_llm_provider: "ollama",
        current_llm_model: "qwen3.5-4b-32k:latest",
      },
      hasValues: new Set(),
    });

    await warmLocalLlm();

    const { url, init } = ollamaWarmupRequest(
      "http://127.0.0.1:11434/v1",
      "qwen3.5-4b-32k:latest",
    );
    expect(mocks.fetch).toHaveBeenCalledWith(url, init);
    expect(url).toBe("http://127.0.0.1:11434/api/generate");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen3.5-4b-32k:latest",
      keep_alive: "5m",
    });
  });

  it("does nothing for cloud providers", async () => {
    mocks.settings.mockResolvedValue({
      values: {
        current_llm_provider: "deepseek",
        current_llm_model: "deepseek-v4-pro",
      },
      hasValues: new Set(),
    });

    await warmLocalLlm();

    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
