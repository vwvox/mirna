import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { commands as localSttCommands } from "@anlg/plugin-local-stt";
import { Cloud, Headphones, Laptop } from "@anlg/ui/components/icons";
import { toast } from "@anlg/ui/components/ui/toast";

import { ChineseDisplayMenu } from "./display-menu";

import { useRegenerateTranscript } from "~/session/components/note-input/transcript/actions";
import { languageName, useTranscriptEngine } from "~/stt/transcript-engine";
import { localSttQueries } from "~/stt/useLocalSttModel";

const QWEN3 = { provider: "soniqo", model: "soniqo-qwen3-small" } as const;

/**
 * One quiet line above the transcript: which engine wrote it and where, why
 * Mirna picked that engine, and how much speaker echo it took out of the mic.
 */
export function TranscriptEngineNote({ sessionId }: { sessionId: string }) {
  const { t, i18n } = useLingui();
  const summary = useTranscriptEngine(sessionId);
  const [downloading, setDownloading] = useState(false);
  const offersQwen3 = Boolean(
    summary?.qwen3Suggested || summary?.unsureLanguages,
  );
  const { data: qwen3Downloaded = false } = useQuery({
    ...localSttQueries.isDownloaded(QWEN3.model),
    enabled: offersQwen3,
  });
  const regenerateTranscript = useRegenerateTranscript(sessionId);
  const transcribeWithQwen3 = useMutation({
    mutationFn: () => regenerateTranscript(QWEN3),
  });
  if (!summary) return null;

  const engine = summary.engine.label;
  const language = summary.language
    ? languageName(summary.language, i18n.locale)
    : undefined;
  const echoSeconds = Math.round(summary.echoRemovedSeconds);
  const madeWith = summary.engine.local
    ? summary.reroutedFrom && language
      ? t`Transcribed on this Mac with ${engine}, because it heard ${language}.`
      : t`Transcribed on this Mac with ${engine}.`
    : t`Transcribed in the cloud by ${engine}.`;

  const downloadQwen3 = async () => {
    setDownloading(true);
    let failure: string | null = null;
    try {
      const result = await localSttCommands.downloadModel(QWEN3.model);
      if (result.status === "error") failure = result.error;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    setDownloading(false);
    if (failure !== null) {
      toast.error(t`Couldn't download Qwen3-ASR`, { description: failure });
      return;
    }
    toast.success(t`Qwen3-ASR is downloading`, {
      description: t`When it's done, choose Transcribe again › Qwen3-ASR in the … menu.`,
    });
  };

  const qwen3Action = qwen3Downloaded ? (
    <button
      type="button"
      disabled={transcribeWithQwen3.isPending}
      onClick={() => transcribeWithQwen3.mutate()}
      className="text-mirna-wordmark font-semibold hover:underline disabled:opacity-50"
    >
      {t`Transcribe again with Qwen3-ASR`}
    </button>
  ) : (
    <button
      type="button"
      disabled={downloading}
      onClick={() => void downloadQwen3()}
      className="text-mirna-wordmark font-semibold hover:underline disabled:opacity-50"
    >
      {t`Download Qwen3-ASR`}
    </button>
  );

  const percent = new Intl.NumberFormat(i18n.locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const unsure = summary.unsureLanguages;
  const heard = unsure
    ?.map(
      (guess) =>
        `${languageName(guess.code, i18n.locale)} ${percent.format(guess.probability)}`,
    )
    .join(", ");

  return (
    <div
      data-transcript-engine
      className="text-muted-foreground flex shrink-0 flex-col gap-1 px-2 pt-3 pb-2 text-xs"
    >
      <p className="flex items-center gap-1.5">
        {summary.engine.local ? (
          <Laptop size={13} aria-hidden />
        ) : (
          <Cloud size={13} aria-hidden />
        )}
        <span className="min-w-0 flex-1">{madeWith}</span>
        {summary.hasChinese ? (
          <ChineseDisplayMenu sessionId={sessionId} />
        ) : null}
      </p>
      {summary.qwen3Suggested && language ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[19px]">
          {t`It heard ${language}, which ${engine} doesn't know. Qwen3-ASR does.`}
          {qwen3Action}
        </p>
      ) : unsure && heard ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[19px]">
          {unsure.length > 1
            ? t`It sounded like more than one language (${heard}). Qwen3-ASR handles mixed languages.`
            : t`It wasn't sure of the language (${heard}). Qwen3-ASR handles mixed languages.`}
          {qwen3Action}
        </p>
      ) : null}
      {echoSeconds >= 1 ? (
        <p className="flex items-center gap-1.5">
          <Headphones size={13} aria-hidden />
          {t`Removed ${echoSeconds} s where your mic picked up your speakers. Headphones avoid this.`}
        </p>
      ) : null}
    </div>
  );
}
