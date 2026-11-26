/**
 * What a lesson needs to know about the language being learned: how it is
 * written, which reading a learner needs next to a word, which way it reads,
 * and whether the Chinese tools (pinyin, tone colours, tone practice) apply.
 */

export type LessonScript =
  | "latin"
  | "han"
  | "japanese"
  | "hangul"
  | "arabic"
  | "cyrillic"
  | "greek"
  | "hebrew"
  | "devanagari"
  | "thai";

export type ReadingKind =
  | "none"
  | "pinyin"
  | "jyutping"
  | "kana"
  | "romanisation"
  | "transliteration"
  | "stressed-transliteration";

export type LanguageFacts = {
  code: string;
  script: LessonScript;
  reading: ReadingKind;
  rtl: boolean;
  /** Mandarin: pinyin, tone colours and the tone practice apply. */
  pinyin: boolean;
  /** Nouns are learned with their article (la cocina, der Tisch). */
  articles: boolean;
};

type Facts = Omit<LanguageFacts, "code">;

const LATIN: Facts = {
  script: "latin",
  reading: "none",
  rtl: false,
  pinyin: false,
  articles: false,
};
const WITH_ARTICLES: Facts = { ...LATIN, articles: true };

const FACTS: Record<string, Facts> = {
  zh: { ...LATIN, script: "han", reading: "pinyin", pinyin: true },
  yue: { ...LATIN, script: "han", reading: "jyutping" },
  ja: { ...LATIN, script: "japanese", reading: "kana" },
  ko: { ...LATIN, script: "hangul", reading: "romanisation" },
  ar: { ...LATIN, script: "arabic", reading: "transliteration", rtl: true },
  he: { ...LATIN, script: "hebrew", reading: "transliteration", rtl: true },
  ru: { ...LATIN, script: "cyrillic", reading: "stressed-transliteration" },
  uk: { ...LATIN, script: "cyrillic", reading: "stressed-transliteration" },
  el: {
    ...LATIN,
    script: "greek",
    reading: "transliteration",
    articles: true,
  },
  hi: { ...LATIN, script: "devanagari", reading: "transliteration" },
  th: { ...LATIN, script: "thai", reading: "romanisation" },
  es: WITH_ARTICLES,
  pt: WITH_ARTICLES,
  fr: WITH_ARTICLES,
  it: WITH_ARTICLES,
  de: WITH_ARTICLES,
  nl: WITH_ARTICLES,
  ga: WITH_ARTICLES,
  sv: WITH_ARTICLES,
  en: LATIN,
  pl: LATIN,
  tr: LATIN,
  vi: LATIN,
};

/** The languages offered when starting a lesson, in this order. */
export const LESSON_LANGUAGES = [
  "zh",
  "en",
  "pt",
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "ja",
  "ko",
  "ar",
  "ru",
  "uk",
  "el",
  "he",
  "hi",
  "pl",
  "sv",
  "tr",
  "vi",
  "th",
  "yue",
  "ga",
] as const;

/**
 * The 30 languages Qwen3-ASR (0.6B and 1.7B) recognises, from its model card
 * (huggingface.co/Qwen/Qwen3-ASR-0.6B). The engine code says it takes any
 * language, so the dialog checks this list instead.
 */
const QWEN3_ASR_LANGUAGES = new Set([
  "zh",
  "en",
  "yue",
  "ar",
  "de",
  "fr",
  "es",
  "pt",
  "id",
  "it",
  "ko",
  "ru",
  "th",
  "vi",
  "ja",
  "tr",
  "hi",
  "ms",
  "nl",
  "sv",
  "da",
  "fi",
  "pl",
  "cs",
  "fil",
  "fa",
  "el",
  "hu",
  "mk",
  "ro",
]);

export function qwen3AsrSupports(codes: readonly string[]): boolean {
  return codes.every((code) => QWEN3_ASR_LANGUAGES.has(baseLanguageCode(code)));
}

export function baseLanguageCode(code: string | null | undefined): string {
  return (code ?? "").split(/[-_]/)[0]?.toLowerCase() ?? "";
}

export function languageFacts(code: string | null | undefined): LanguageFacts {
  const base = baseLanguageCode(code);
  return { code: base, ...(FACTS[base] ?? LATIN) };
}

/** Pinyin and tones apply to this lesson's words (Mandarin, or a lesson from before languages were set). */
export function usesPinyin(code: string | null | undefined): boolean {
  return code === null || code === undefined || languageFacts(code).pinyin;
}

const SCRIPT_PATTERNS: Record<Exclude<LessonScript, "latin">, RegExp> = {
  han: /\p{Script=Han}/u,
  japanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  arabic: /\p{Script=Arabic}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  greek: /\p{Script=Greek}/u,
  hebrew: /\p{Script=Hebrew}/u,
  devanagari: /\p{Script=Devanagari}/u,
  thai: /\p{Script=Thai}/u,
};

/**
 * Whether a line could be in the language: written in its script. Languages
 * written in Latin letters can't be told apart this way, so they always pass.
 */
export function looksLikeLanguage(text: string, code: string): boolean {
  const { script } = languageFacts(code);
  return script === "latin" || SCRIPT_PATTERNS[script].test(text);
}

/** The pattern for one character of the language's script, or null for Latin. */
export function scriptPattern(code: string): RegExp | null {
  const { script } = languageFacts(code);
  return script === "latin" ? null : SCRIPT_PATTERNS[script];
}

/** The rule the study sheet prompt gives for the reading column. */
export function readingRule(code: string, name: string): string {
  switch (languageFacts(code).reading) {
    case "pinyin":
      return "Pinyin with tone marks.";
    case "jyutping":
      return "Jyutping with tone numbers.";
    case "kana":
      return "The word in hiragana (katakana for loanwords), as a learner reads it; empty when the term is already all kana.";
    case "romanisation":
      return `The standard romanisation of ${name}.`;
    case "transliteration":
      return "A simple transliteration in Latin letters.";
    case "stressed-transliteration":
      return "A simple transliteration in Latin letters, with an acute accent on the stressed vowel.";
    case "none":
      return `Leave it empty: ${name} is written in Latin letters.`;
  }
}

/** The kind of reading as a column heading: "Pinyin", "Kana" or "Reading". */
export function readingHeading(
  code: string | null | undefined,
): "pinyin" | "kana" | "reading" {
  const { reading } = languageFacts(code);
  if (reading === "pinyin" || code === null || code === undefined)
    return "pinyin";
  return reading === "kana" ? "kana" : "reading";
}

const ARTICLES: Record<string, readonly string[]> = {
  es: ["el", "la", "los", "las", "un", "una"],
  pt: ["o", "a", "os", "as", "um", "uma"],
  fr: ["le", "la", "les", "un", "une"],
  it: ["il", "lo", "la", "i", "gli", "le", "un", "una", "uno"],
  de: ["der", "die", "das", "ein", "eine"],
  nl: ["de", "het", "een"],
  sv: ["en", "ett"],
  ga: ["an", "na"],
  el: ["ο", "η", "το", "οι", "τα"],
};

/**
 * A noun's article apart from the word, so the sheet can show it lighter
 * ("la cocina", "l'école"). Null when the term doesn't start with one.
 */
export function splitArticle(
  term: string,
  code: string | null | undefined,
): { article: string; rest: string } | null {
  const base = baseLanguageCode(code);
  const elided = /^(l['’])(\S.*)$/iu.exec(term);
  if (elided && (base === "fr" || base === "it")) {
    return { article: elided[1]!, rest: elided[2]! };
  }
  const match = /^(\S+)\s+(\S.*)$/u.exec(term);
  if (!match || !ARTICLES[base]?.includes(match[1]!.toLowerCase())) return null;
  return { article: match[1]!, rest: match[2]! };
}

export function languageName(code: string, locale = "en"): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}
