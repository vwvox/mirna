import { PROVIDERS as LLM_PROVIDERS } from "~/settings/ai/llm/shared";
import { PROVIDERS as STT_PROVIDERS } from "~/settings/ai/stt/shared";
import { useConfigValue } from "~/shared/config";

// Settings use "local_file" and "apple_speech"; saved transcripts record the
// batch provider that ran, "whispercpp" and "applespeech".
const LOCAL_STT_PROVIDERS = new Set([
  "local_file",
  "whispercpp",
  "soniqo",
  "apple_speech",
  "applespeech",
]);
const LOCAL_LLM_PROVIDERS = new Set(["ollama", "lmstudio", "unsloth"]);

export type ProcessingStep = {
  /** Short engine name for status lines, e.g. "Whisper", "Qwen 3.5", "DeepSeek". */
  label: string;
  local: boolean;
};

export type ProcessingLocation = {
  transcription: ProcessingStep | null;
  notes: ProcessingStep | null;
  /** True when every configured step runs on this Mac. */
  allLocal: boolean;
};

export function describeTranscription(
  provider: string | undefined,
  model: string | undefined,
): ProcessingStep | null {
  if (!provider) return null;
  const local = LOCAL_STT_PROVIDERS.has(provider);
  if (provider === "local_file" || provider === "whispercpp") {
    return { label: "Whisper", local };
  }
  if (provider === "soniqo") {
    if (model?.includes("qwen3-large")) {
      return { label: "Qwen3-ASR Large", local };
    }
    if (model?.includes("qwen3")) return { label: "Qwen3-ASR", local };
    if (model?.includes("omnilingual")) return { label: "Omnilingual", local };
    return { label: "Parakeet", local };
  }
  if (provider === "apple_speech" || provider === "applespeech") {
    return { label: "Apple Speech", local };
  }
  const name = STT_PROVIDERS.find(
    (entry) => entry.id === provider,
  )?.displayName;
  return { label: name ?? model ?? provider, local };
}

export function describeNotesModel(
  provider: string | undefined,
  model: string | undefined,
): ProcessingStep | null {
  if (!provider) return null;
  const local = LOCAL_LLM_PROVIDERS.has(provider);
  if (local && model) return { label: modelFamily(model), local };
  const name = LLM_PROVIDERS.find(
    (entry) => entry.id === provider,
  )?.displayName;
  return { label: name ?? provider, local };
}

/** "qwen3.5-4b-32k" → "Qwen 3.5", "gemma4:e4b" → "Gemma 4"; unknown ids pass through. */
export function modelFamily(model: string): string {
  const match = /^([a-z]+)[-_ ]?(\d+(?:\.\d+)?)?/i.exec(model.trim());
  if (!match) return model;
  const family = match[1]!;
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  return match[2] ? `${name} ${match[2]}` : name;
}

export function summarizeProcessingLocation(
  transcription: ProcessingStep | null,
  notes: ProcessingStep | null,
): ProcessingLocation {
  const steps = [transcription, notes].filter(
    (step): step is ProcessingStep => step !== null,
  );
  return {
    transcription,
    notes,
    allLocal: steps.length > 0 && steps.every((step) => step.local),
  };
}

export function useProcessingLocation(): ProcessingLocation {
  const sttProvider = useConfigValue("current_stt_provider") as
    | string
    | undefined;
  const sttModel = useConfigValue("current_stt_model") as string | undefined;
  const llmProvider = useConfigValue("current_llm_provider") as
    | string
    | undefined;
  const llmModel = useConfigValue("current_llm_model") as string | undefined;

  return summarizeProcessingLocation(
    describeTranscription(sttProvider, sttModel),
    describeNotesModel(llmProvider, llmModel),
  );
}
