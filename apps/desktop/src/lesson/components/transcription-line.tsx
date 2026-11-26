import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";

import { commands as localSttCommands } from "@anlg/plugin-local-stt";
import { Check, Warning } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { languageName, qwen3AsrSupports } from "../languages";

import { useConfigValues } from "~/shared/config";
import { isOnDeviceSttModel, isSupportedLanguagesBatch } from "~/stt/capabilities";
import { localSttQueries } from "~/stt/useLocalSttModel";

const PARAKEET = "soniqo-parakeet-batch";
const QWEN3 = "soniqo-qwen3-small";

export type TranscriptionVerdict =
  | { kind: "ok"; engine: "Parakeet" | "Qwen3-ASR" }
  | { kind: "download"; engine: "Qwen3-ASR" }
  | { kind: "none" };

/** Which on-device engine can write this lesson's transcript, if any. */
export function transcriptionVerdict({
  parakeet,
  qwen3,
}: {
  parakeet: { supports: boolean; downloaded: boolean };
  qwen3: { supports: boolean; downloaded: boolean };
}): TranscriptionVerdict {
  if (parakeet.supports && parakeet.downloaded)
    return { kind: "ok", engine: "Parakeet" };
  if (qwen3.supports && qwen3.downloaded)
    return { kind: "ok", engine: "Qwen3-ASR" };
  if (qwen3.supports) return { kind: "download", engine: "Qwen3-ASR" };
  return { kind: "none" };
}

function useEngine(model: typeof PARAKEET | typeof QWEN3, languages: string[]) {
  const supports = useQuery({
    queryKey: ["lesson-engine-languages", model, languages.join(",")],
    enabled: languages.length > 0,
    queryFn: () =>
      model === QWEN3
        ? qwen3AsrSupports(languages)
        : isSupportedLanguagesBatch("soniqo", model, languages),
  });
  const downloaded = useQuery({
    ...localSttQueries.isDownloaded(model),
    enabled: languages.length > 0,
  });
  return {
    ready: supports.isSuccess && downloaded.isSuccess,
    supports: supports.data === true,
    downloaded: downloaded.data === true,
    refetch: downloaded.refetch,
  };
}

/**
 * One line under the languages: whether this Mac can transcribe the class, and
 * the download when Qwen3-ASR would. Says nothing when transcription happens in
 * the cloud, where the provider decides.
 */
export function TranscriptionLine({ languages }: { languages: string[] }) {
  const { t, i18n } = useLingui();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const) as {
    current_stt_provider: string | undefined;
    current_stt_model: string | undefined;
  };
  const onDevice =
    !current_stt_provider ||
    isOnDeviceSttModel(current_stt_provider, current_stt_model);
  const wanted = onDevice ? [...new Set(languages.filter(Boolean))] : [];
  const parakeet = useEngine(PARAKEET, wanted);
  const qwen3 = useEngine(QWEN3, wanted);
  const download = useMutation({
    mutationFn: async () => {
      const result = await localSttCommands.downloadModel(QWEN3);
      if (result.status === "error") throw new Error(result.error);
    },
    onSuccess: () => {
      toast.success(t`Qwen3-ASR is downloading`);
      void qwen3.refetch();
    },
    onError: (error) =>
      toast.error(t`Couldn't download Qwen3-ASR`, {
        description: error instanceof Error ? error.message : String(error),
      }),
  });
  if (wanted.length === 0 || !parakeet.ready || !qwen3.ready) return null;

  const names = wanted.map((code) => languageName(code, i18n.locale));
  const all = names.join(t` and `);
  const first = names[0]!;
  const verdict = transcriptionVerdict({ parakeet, qwen3 });
  const ok = verdict.kind === "ok";

  return (
    <div
      role="status"
      className={cn([
        "flex items-start gap-3 rounded-lg px-4 py-3 text-sm",
        ok
          ? "bg-mirna-moss/50 text-mirna-serra dark:bg-mirna-serra/30 dark:text-mirna-moss"
          : "border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
      ])}
    >
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0" weight="bold" />
      ) : (
        <Warning className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="flex-1">
        {verdict.kind === "ok" ? (
          verdict.engine === "Parakeet" ? (
            <Trans>Parakeet on this Mac transcribes {all}.</Trans>
          ) : (
            <Trans>Qwen3-ASR on this Mac transcribes {all} after class.</Trans>
          )
        ) : verdict.kind === "download" ? (
          <Trans>{first} needs Qwen3-ASR, which isn't on this Mac yet.</Trans>
        ) : (
          <Trans>
            No model on this Mac can transcribe {first}. Mirna still records the
            class; for a study sheet, pick a cloud transcription service in
            Settings.
          </Trans>
        )}
      </span>
      {verdict.kind === "download" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          <Trans>Download Qwen3-ASR</Trans>
        </Button>
      ) : null}
    </div>
  );
}
