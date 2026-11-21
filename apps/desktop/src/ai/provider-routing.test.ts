import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lobehub/icons", () =>
  Object.fromEntries(
    [
      "AlibabaCloud",
      "Anthropic",
      "Apple",
      "AssemblyAI",
      "Aws",
      "Azure",
      "AzureAI",
      "Bedrock",
      "Cerebras",
      "Claude",
      "Cohere",
      "DeepSeek",
      "ElevenLabs",
      "Fireworks",
      "Gemini",
      "GithubCopilot",
      "GoogleCloud",
      "Grok",
      "Groq",
      "LmStudio",
      "Mistral",
      "Moonshot",
      "Nvidia",
      "Ollama",
      "OpenAI",
      "OpenRouter",
      "SiliconCloud",
      "Together",
      "VertexAI",
      "WorkersAI",
      "XAI",
      "ZAI",
    ].map((name) => [name, () => null]),
  ),
);
vi.mock("~/settings/ai/shared", () => ({
  AnarlogProviderIcon: () => null,
  ProviderBrandImage: () => null,
  ProviderLobeIcon: () => null,
}));
vi.mock("~/stt/useLocalSttModel", () => ({ localSttQueries: {} }));

afterEach(() => {
  vi.doUnmock("~/env");
  vi.resetModules();
});

it.each([undefined, "https://api.anarlog.so"])(
  "never offers vendor-hosted providers, even with an AI override of %s",
  async (aiUrl) => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        VITE_API_URL: "http://localhost:3001",
        VITE_AI_API_URL: aiUrl,
      },
    }));
    const { PROVIDERS: stt } = await import("~/settings/ai/stt/shared");
    const { PROVIDERS: llm } = await import("~/settings/ai/llm/shared");
    expect(stt.find((provider) => provider.id === "anarlog")).toBeUndefined();
    expect(llm.find((provider) => provider.id === "anarlog")).toBeUndefined();
  },
  30_000,
);
