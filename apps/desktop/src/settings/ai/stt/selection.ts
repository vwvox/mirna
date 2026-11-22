import { getTranscriptionLanguages } from "~/stt/capabilities";
import {
  getDefaultSttModel,
  getPreferredProviderModel,
} from "~/stt/model-selection";

export { getDefaultSttModel, getPreferredProviderModel };

export async function getLanguageSupportIssue(
  mainLanguage: string | null | undefined,
  spokenLanguages: readonly string[] | null | undefined,
  isSupported: (languages: readonly string[]) => Promise<boolean>,
) {
  const languages = getTranscriptionLanguages(mainLanguage, spokenLanguages);
  if (await isSupported(languages)) {
    return null;
  }

  const supportByLanguage = await Promise.all(
    languages.map(async (language) => ({
      language,
      supported: await isSupported([language]),
    })),
  );

  return {
    unsupportedLanguages: supportByLanguage
      .filter(({ supported }) => !supported)
      .map(({ language }) => language),
  };
}

const ON_DEVICE_STT_PROVIDERS = new Set([
  "soniqo",
  "apple_speech",
  "local_file",
]);

export function getDefaultSttSelection(
  providerIds: readonly string[],
  statuses: Record<
    string,
    {
      configured: boolean;
      models: { id: string; isDownloaded?: boolean }[];
    }
  >,
  currentProvider?: string,
  currentModel?: string,
) {
  // Repairing an on-device choice never moves recordings to the cloud.
  const onDeviceOnly =
    !!currentProvider && ON_DEVICE_STT_PROVIDERS.has(currentProvider);
  for (const provider of providerIds) {
    const status = statuses[provider];
    if (!status?.configured) {
      continue;
    }
    if (onDeviceOnly && !ON_DEVICE_STT_PROVIDERS.has(provider)) {
      continue;
    }

    const model = getPreferredProviderModel(
      provider === currentProvider ? currentModel : undefined,
      status.models,
      {
        allowSavedModelWithoutChoices:
          provider === "custom" || provider === "nvidia",
      },
    );

    if (model) {
      return { provider, model };
    }
  }

  return null;
}

export function resolveLiveLanguageSupportMode({
  isOnDeviceModel,
  useLiveOnDeviceModel,
  liveSupported,
}: {
  isOnDeviceModel: boolean;
  useLiveOnDeviceModel: boolean;
  liveSupported: boolean | undefined;
}): boolean | undefined {
  return isOnDeviceModel
    ? useLiveOnDeviceModel && liveSupported
    : liveSupported;
}
