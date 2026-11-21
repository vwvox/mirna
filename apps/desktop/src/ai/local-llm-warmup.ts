import { getStoredAiProvider } from "~/settings/providers";
import { getStoredSettingValues } from "~/settings/queries";

import { providerFetch } from "./provider-fetch";

const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
// Ollama unloads a model this long after its last request. Preloading when a
// recording stops overlaps the multi-second model load with transcription, so
// the summary starts on a warm model, without holding its memory all day.
const OLLAMA_KEEP_ALIVE = "5m";

export function ollamaWarmupRequest(
  baseUrl: string,
  model: string,
): { url: string; init: RequestInit } {
  const origin = new URL(baseUrl.replace(/\/v1\/?$/, "")).origin;
  return {
    url: `${origin}/api/generate`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ model, keep_alive: OLLAMA_KEEP_ALIVE }),
    },
  };
}

export async function warmLocalLlm(): Promise<void> {
  try {
    const { values } = await getStoredSettingValues();
    const model = values.current_llm_model;
    if (values.current_llm_provider !== "ollama" || !model) {
      return;
    }

    const provider = await getStoredAiProvider("llm", "ollama");
    const baseUrl = provider?.base_url?.trim() || OLLAMA_DEFAULT_BASE_URL;
    const { url, init } = ollamaWarmupRequest(baseUrl, model);
    await providerFetch(url, init);
  } catch (error) {
    console.warn("[ai] local model warm-up failed", error);
  }
}
