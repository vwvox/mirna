import { useLiveQuery } from "~/db";
import {
  describeTranscription,
  type ProcessingStep,
} from "~/shared/processing-location";

type TranscriptEngineRow = {
  provider: string | null;
  model: string | null;
  language: string | null;
  metadata_json: string | null;
  /** 1 when the transcript contains Chinese characters. */
  has_han?: number | null;
};

/** What made a note's transcript, for the line above it. */
export type TranscriptEngineSummary = {
  engine: ProcessingStep;
  /** Base code of the language heard ("zh"), when the engine said. */
  language?: string;
  /** Set when Mirna switched engines because of the language it heard. */
  reroutedFrom?: ProcessingStep;
  /** A language Parakeet doesn't know was heard, but Qwen3-ASR isn't downloaded. */
  qwen3Suggested: boolean;
  /** Seconds of mic audio silenced because they echoed the speakers. */
  echoRemovedSeconds: number;
  /** The transcript has Chinese characters, so pinyin can be shown. */
  hasChinese: boolean;
};

const TRANSCRIPT_ENGINE_SQL = `
  SELECT provider, model, language, metadata_json,
    words_json GLOB '*[一-鿿]*' AS has_han
  FROM transcripts
  WHERE session_id = ?
    AND deleted_at IS NULL
    AND source = 'batch_transcription'
  ORDER BY created_at DESC, id DESC
`;

function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Rows newest first: the newest transcript names the engine; echo adds up. */
export function summarizeTranscriptEngine(
  rows: readonly TranscriptEngineRow[],
): TranscriptEngineSummary | null {
  const latest = rows[0];
  if (!latest?.provider) return null;
  const engine = describeTranscription(
    latest.provider,
    latest.model ?? undefined,
  );
  if (!engine) return null;

  const metadata = parseMetadata(latest.metadata_json);
  const routing = record(metadata.engine);
  const requested =
    typeof routing.requested_model === "string"
      ? routing.requested_model
      : undefined;
  const reroutedFrom =
    requested && requested !== latest.model
      ? (describeTranscription(latest.provider, requested) ?? undefined)
      : undefined;
  const echoRemovedSeconds = rows.reduce((total, row) => {
    const seconds = record(
      parseMetadata(row.metadata_json).mic_echo,
    ).removed_seconds;
    return total + (typeof seconds === "number" ? seconds : 0);
  }, 0);

  return {
    engine,
    language: latest.language || undefined,
    reroutedFrom,
    qwen3Suggested: routing.qwen3_suggested === true,
    echoRemovedSeconds,
    hasChinese:
      latest.language === "zh" || rows.some((row) => Boolean(row.has_han)),
  };
}

export function useTranscriptEngine(
  sessionId: string,
): TranscriptEngineSummary | null {
  const { data = null } = useLiveQuery<
    TranscriptEngineRow,
    TranscriptEngineSummary | null
  >({
    sql: TRANSCRIPT_ENGINE_SQL,
    params: [sessionId],
    enabled: Boolean(sessionId),
    mapRows: summarizeTranscriptEngine,
  });
  return data;
}

/** "zh" → "Chinese", in the app's language; unknown codes pass through. */
export function languageName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}
