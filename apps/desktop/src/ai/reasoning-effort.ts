import type { defaultSettingsMiddleware } from "ai";

const REASONING_EFFORTS = ["default", "off", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const normalizeReasoningEffort = (value: unknown): ReasoningEffort =>
  REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : "default";

// Anarlog Pro picks its own model settings, and Apple Foundation has no
// reasoning knob to turn.
export const supportsReasoningEffort = (providerId: string): boolean =>
  providerId !== "anarlog" && providerId !== "apple_foundation";

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "unsloth"]);

// Small local models that think by default (e.g. Qwen 3.5 on Ollama) spend
// minutes on hidden reasoning before a summary, so local providers treat
// Default as Off. Cloud providers keep their own defaults.
export const supportsReasoningOff = (providerId: string): boolean =>
  LOCAL_PROVIDERS.has(providerId);

const effectiveReasoningEffort = (
  providerId: string,
  effort: ReasoningEffort,
): ReasoningEffort => {
  if (!supportsReasoningOff(providerId)) {
    return effort === "off" ? "default" : effort;
  }
  return effort === "default" ? "off" : effort;
};

type ProviderOptions = NonNullable<
  Parameters<typeof defaultSettingsMiddleware>[0]["settings"]["providerOptions"]
>;

const GEMINI_THINKING_BUDGET = { low: 1024, medium: 8192, high: 24576 };

// Gemini 2.5 only understands a token budget, thinkingLevel is 3.x+, and
// older generations reject thinkingConfig outright, so unknown ids send nothing.
const geminiThinkingConfig = (
  modelId: string,
  effort: Exclude<ReasoningEffort, "default" | "off">,
) => {
  const version = /gemini-(\d+)(?:\.(\d+))?/.exec(modelId);
  if (!version) {
    return null;
  }
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  if (major >= 3) {
    return { thinkingLevel: effort };
  }
  if (major === 2 && minor === 5) {
    return { thinkingBudget: GEMINI_THINKING_BUDGET[effort] };
  }
  return null;
};

export const reasoningProviderOptions = (
  providerId: string,
  modelId: string,
  requestedEffort: ReasoningEffort,
): ProviderOptions | null => {
  const effort = effectiveReasoningEffort(providerId, requestedEffort);
  if (effort === "default" || !supportsReasoningEffort(providerId)) {
    return null;
  }

  if (effort === "off") {
    // Local servers speak the OpenAI-compatible API, where "none" disables
    // thinking (Ollama maps it to think=false).
    return { [providerId]: { reasoningEffort: "none" } };
  }

  switch (providerId) {
    case "openai":
    case "chatgpt":
      return { openai: { reasoningEffort: effort } };
    case "azure_openai":
      return { azure: { reasoningEffort: effort } };
    case "anthropic":
      return { anthropic: { thinking: { type: "adaptive" }, effort } };
    case "openrouter":
      return { openrouter: { reasoning: { effort } } };
    case "google_generative_ai": {
      const thinkingConfig = geminiThinkingConfig(modelId, effort);
      return thinkingConfig ? { google: { thinkingConfig } } : null;
    }
    default:
      // Every other provider goes through @ai-sdk/openai-compatible, which
      // reads options under the provider name and sends `reasoning_effort`.
      return { [providerId]: { reasoningEffort: effort } };
  }
};
