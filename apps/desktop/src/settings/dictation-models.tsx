import { Trans, useLingui } from "@lingui/react/macro";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";

import { useConfiguredMapping as useLlmProviders } from "~/settings/ai/llm/select";
import { PROVIDERS as LLM_PROVIDERS } from "~/settings/ai/llm/shared";
import { ModelCombobox } from "~/settings/ai/shared/model-combobox";
import { getConfiguredProviders } from "~/settings/ai/shared/selection";
import { useConfiguredMapping as useSttProviders } from "~/settings/ai/stt/select";
import {
  displayModelLabel,
  PROVIDERS as STT_PROVIDERS,
} from "~/settings/ai/stt/shared";
import { setSettingValues } from "~/settings/queries";
import { SETTING_CONTROL_CLASS, SettingRow } from "~/settings/setting-row";
import { useConfigValues } from "~/shared/config";

const MAIN = "__main__";
const SEPARATOR = "::";

// A BYO model file runs in the one local model server meetings use; dictation can't load a
// second one beside it, so it is only reachable as the main transcription model.
const MAIN_ONLY_STT_PROVIDERS = new Set(["local_file"]);

export type SttOption = {
  provider: string;
  providerName: string;
  model: string;
  label: string;
};

/** Speech models dictation may use on its own: configured, downloaded and not deprecated. */
export function dictationSttOptions(
  providers: ReadonlyArray<{ id: string; displayName: string }>,
  mapping: Record<
    string,
    | {
        configured: boolean;
        models: Array<{
          id: string;
          isDownloaded: boolean;
          isDeprecated?: boolean;
          displayName?: string;
        }>;
      }
    | undefined
  >,
): SttOption[] {
  return providers.flatMap((provider) => {
    const status = mapping[provider.id];
    if (!status?.configured || MAIN_ONLY_STT_PROVIDERS.has(provider.id))
      return [];
    return status.models
      .filter((model) => model.isDownloaded && !model.isDeprecated)
      .map((model) => ({
        provider: provider.id,
        providerName: provider.displayName,
        model: model.id,
        label: displayModelLabel(model.id, model.displayName),
      }));
  });
}

/** Optional models for dictation only; each falls back to the main selection when unset. */
export function DictationModelSettings() {
  return (
    <div className="flex flex-col gap-6">
      <DictationSpeechModel />
      <DictationCleanupModel />
    </div>
  );
}

function DictationSpeechModel() {
  const { t } = useLingui();
  const { providers } = useSttProviders();
  const values = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
    "dictation_stt_provider",
    "dictation_stt_model",
  ] as const);
  const options = dictationSttOptions(STT_PROVIDERS, providers);
  const labelFor = (provider?: string, model?: string) => {
    if (!provider || !model) return null;
    const option = options.find(
      (item) => item.provider === provider && item.model === model,
    );
    const providerName =
      STT_PROVIDERS.find((item) => item.id === provider)?.displayName ??
      provider;
    return `${providerName} · ${option?.label ?? displayModelLabel(model)}`;
  };
  const main = labelFor(values.current_stt_provider, values.current_stt_model);
  const own =
    values.dictation_stt_provider && values.dictation_stt_model
      ? `${values.dictation_stt_provider}${SEPARATOR}${values.dictation_stt_model}`
      : MAIN;
  const ownMissing =
    own !== MAIN &&
    !options.some(
      (item) => `${item.provider}${SEPARATOR}${item.model}` === own,
    );
  const groups = groupBy(options, (item) => item.providerName);
  const missingLabel = ownMissing
    ? (labelFor(values.dictation_stt_provider, values.dictation_stt_model) ??
      own)
    : "";

  const choose = (value: string) => {
    if (value === MAIN) {
      void setSettingValues({
        dictation_stt_provider: "",
        dictation_stt_model: "",
      });
      return;
    }
    const [provider, ...rest] = value.split(SEPARATOR);
    void setSettingValues({
      dictation_stt_provider: provider,
      dictation_stt_model: rest.join(SEPARATOR),
    });
  };

  return (
    <SettingRow
      title={<Trans>Speech model</Trans>}
      description={
        <Trans>
          Pick a faster model for dictation than for meetings. Your own model
          file (BYO-model) can only be used as your main transcription model.
        </Trans>
      }
    >
      {(labelProps) => (
        <Select value={own} onValueChange={choose}>
          <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
            <SelectValue placeholder={t`Same as transcription`}>
              {own === MAIN ? t`Same as transcription` : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MAIN}>
              {main
                ? t`Same as transcription (${main})`
                : t`Same as transcription`}
            </SelectItem>
            {ownMissing && (
              <SelectItem value={own} disabled>
                {t`${missingLabel} (unavailable)`}
              </SelectItem>
            )}
            {groups.map(([providerName, items]) => (
              <SelectGroup key={providerName}>
                <SelectSeparator />
                <SelectLabel>{providerName}</SelectLabel>
                {items.map((item) => (
                  <SelectItem
                    key={`${item.provider}${SEPARATOR}${item.model}`}
                    value={`${item.provider}${SEPARATOR}${item.model}`}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}

function DictationCleanupModel() {
  const { t } = useLingui();
  const { providers } = useLlmProviders();
  const values = useConfigValues([
    "current_llm_provider",
    "current_llm_model",
    "dictation_llm_provider",
    "dictation_llm_model",
  ] as const);
  const options = getConfiguredProviders(LLM_PROVIDERS, providers);
  const providerName = (id?: string) =>
    LLM_PROVIDERS.find((item) => item.id === id)?.displayName ?? id;
  const main =
    values.current_llm_provider && values.current_llm_model
      ? `${providerName(values.current_llm_provider)} · ${values.current_llm_model}`
      : null;
  const provider = values.dictation_llm_provider || MAIN;
  const providerMissing =
    provider !== MAIN && !options.some((item) => item.id === provider);
  const missingName = providerMissing ? providerName(provider) : "";

  return (
    <div className="flex flex-col gap-3">
      <SettingRow
        title={<Trans>Cleanup model</Trans>}
        description={
          <Trans>
            A small, fast model keeps cleanup inside its few-second limit.
            Cleanup sends your words to the provider you pick here.
          </Trans>
        }
      >
        {(labelProps) => (
          <Select
            value={provider}
            onValueChange={(value) =>
              void setSettingValues({
                dictation_llm_provider: value === MAIN ? "" : value,
                dictation_llm_model: "",
              })
            }
          >
            <SelectTrigger {...labelProps} className={SETTING_CONTROL_CLASS}>
              <SelectValue placeholder={t`Same as AI model`}>
                {provider === MAIN ? t`Same as AI model` : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MAIN}>
                {main ? t`Same as AI model (${main})` : t`Same as AI model`}
              </SelectItem>
              {providerMissing && (
                <SelectItem value={provider} disabled>
                  {t`${missingName} (unavailable)`}
                </SelectItem>
              )}
              {options.length > 0 && <SelectSeparator />}
              {options.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingRow>
      {provider !== MAIN && (
        <div className="flex flex-col gap-2">
          <ModelCombobox
            providerId={provider}
            value={values.dictation_llm_model ?? ""}
            onChange={(model) =>
              void setSettingValues({
                dictation_llm_provider: provider,
                dictation_llm_model: model,
              })
            }
            listModels={providers[provider]?.listModels}
            isConfigured={providers[provider]?.configured ?? false}
            placeholder={t`Choose a model`}
          />
          {!values.dictation_llm_model && (
            <p className="text-muted-foreground text-xs">
              <Trans>
                Choose a model. Until then, cleanup uses your main AI model.
              </Trans>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function groupBy<T>(
  items: T[],
  key: (item: T) => string,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups];
}
