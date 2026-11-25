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

/** One language Mirna's language check heard, with its share of the guess. */
export type LanguageGuess = { code: string; probability: number };

/** What made a note's transcript, for the line above it. */
export type TranscriptEngineSummary = {
  engine: ProcessingStep;
  /** Base code of the language heard ("zh"), when the engine said. */
  language?: string;
  /** Set when Mirna switched engines because of the language it heard. */
  reroutedFrom?: ProcessingStep;
  /** A language Parakeet doesn't know was heard, but Qwen3-ASR isn't downloaded. */
  qwen3Suggested: boolean;
  /**
   * Parakeet wrote it, but the language check wasn't sure or also heard a
   * language Parakeet doesn't know: the languages heard, likeliest first.
   */
  unsureLanguages?: LanguageGuess[];
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

/** Below this, the top language guess is too unsure to leave to Parakeet. */
const SURE_LANGUAGE_PROBABILITY = 0.8;
/**
 * A language with at least this share of the guess counts as heard. English
 * recordings give stray languages (Welsh, Latin) under 0.07.
 */
const HEARD_LANGUAGE_PROBABILITY = 0.1;
const MAX_LANGUAGES_SHOWN = 3;

type ChannelGuess = LanguageGuess & { parakeetKnows?: boolean };

function languageGuess(value: unknown): ChannelGuess | undefined {
  const guess = record(value);
  if (typeof guess.code !== "string" || typeof guess.probability !== "number") {
    return undefined;
  }
  return {
    code: guess.code,
    probability: guess.probability,
    parakeetKnows:
      typeof guess.parakeet_knows === "boolean"
        ? guess.parakeet_knows
        : undefined,
  };
}

/**
 * Each channel's language guesses, likeliest first. Older transcripts only
 * saved each channel's top guess.
 */
function channelGuesses(routing: Record<string, unknown>): ChannelGuess[][] {
  if (Array.isArray(routing.predictions_by_channel)) {
    return routing.predictions_by_channel.map((channel) =>
      Array.isArray(channel)
        ? channel.flatMap((value) => languageGuess(value) ?? [])
        : [],
    );
  }
  if (Array.isArray(routing.languages_by_channel)) {
    return routing.languages_by_channel.map((value) => {
      const guess = languageGuess(value);
      return guess ? [guess] : [];
    });
  }
  return [];
}

function unsureLanguages(
  routing: Record<string, unknown>,
): LanguageGuess[] | undefined {
  const channels = channelGuesses(routing);
  const unsure = channels.some(
    (guesses) =>
      (guesses[0]?.probability ?? 1) < SURE_LANGUAGE_PROBABILITY ||
      guesses.some(
        (guess) =>
          guess.parakeetKnows === false &&
          guess.probability >= HEARD_LANGUAGE_PROBABILITY,
      ),
  );
  if (!unsure) return undefined;

  const heard = new Map<string, number>();
  for (const guess of channels.flat()) {
    heard.set(
      guess.code,
      Math.max(heard.get(guess.code) ?? 0, guess.probability),
    );
  }
  return [...heard]
    .map(([code, probability]) => ({ code, probability }))
    .sort((a, b) => b.probability - a.probability)
    .filter(
      (guess, index) =>
        index === 0 || guess.probability >= HEARD_LANGUAGE_PROBABILITY,
    )
    .slice(0, MAX_LANGUAGES_SHOWN);
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

  const qwen3Suggested = routing.qwen3_suggested === true;
  const madeByParakeet =
    latest.provider === "soniqo" && latest.model === "soniqo-parakeet-batch";

  return {
    engine,
    language: latest.language || undefined,
    reroutedFrom,
    qwen3Suggested,
    unsureLanguages:
      madeByParakeet && !qwen3Suggested ? unsureLanguages(routing) : undefined,
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
