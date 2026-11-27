import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { languageFacts, scriptPattern } from "./languages";
import { type LessonRoleOf, lessonRoles, speakingMs } from "./roles";

export type LessonLanguageStats = {
  /** Time with speech in it that could be told apart. */
  spokenMs: number;
  /** The part of that spent on the language being learned. */
  inLanguageMs: number;
  /** The student's own share of it; 0 when no voice was recognised as theirs. */
  studentInLanguageMs: number;
};

/** @deprecated The Chinese-only name; same numbers. */
export type LessonChineseStats = {
  spokenMs: number;
  chineseMs: number;
  studentChineseMs: number;
};

const HAN = /\p{Script=Han}/gu;
const WORD = /\p{L}+/gu;
const VOWELS = /[aeiouyàáâãäåèéêëìíîïòóôõöùúûüāēīōūǎěǐǒǔǖǘǚǜ]+/giu;

/**
 * Rough syllable counts, Chinese and not. Each character is one syllable; other
 * words count their vowel groups ("weather" two, "the" one). Speech runs at
 * about the same number of syllables a second in either language, so these
 * split a line's time between them.
 */
export function countSyllables(text: string): {
  chinese: number;
  other: number;
} {
  const chinese = text.match(HAN)?.length ?? 0;
  let other = 0;
  for (const word of text.replace(HAN, " ").match(WORD) ?? []) {
    other += Math.max(1, word.match(VOWELS)?.length ?? 0);
  }
  return { chinese, other };
}

/** Scripts written a syllable a character; the rest are counted a word at a time. */
const SYLLABIC = new Set(["han", "japanese", "hangul"]);

/** Syllables in the learning script and outside it, for a language not written in Latin letters. */
function splitByScript(
  text: string,
  code: string,
): { learning: number; other: number } {
  const pattern = scriptPattern(code)!;
  const global = new RegExp(pattern.source, "gu");
  if (SYLLABIC.has(languageFacts(code).script)) {
    const learning = text.match(global)?.length ?? 0;
    let other = 0;
    for (const word of text.replace(global, " ").match(WORD) ?? []) {
      other += Math.max(1, word.match(VOWELS)?.length ?? 0);
    }
    return { learning, other };
  }
  let learning = 0;
  let other = 0;
  for (const word of text.match(WORD) ?? []) {
    if (pattern.test(word))
      learning += Math.max(1, Math.round(word.length / 3));
    else other += Math.max(1, word.match(VOWELS)?.length ?? 0);
  }
  return { learning, other };
}

/**
 * Short words common in speech, for telling apart two languages written in Latin
 * letters. A word counts only when it isn't also on the other language's list.
 */
const COMMON_WORDS: Record<string, string> = {
  en: "the and you that it is was this what with for have are they but not we can do so if there your my me be just yes okay know think like would about one very good right how why when where because which should could then now here",
  es: "el la los las que y en un una es por con para muy pero sí está están estoy eres soy tengo tiene hay qué cómo dónde cuando porque también bien ahora aquí yo tú usted nosotros mi su del al más este esta ese eso hola gracias",
  pt: "o os as que e em um uma é com para muito mas sim está estou eu você ele ela nós não também bem agora aqui do da dos das no na mais isso este esta tem obrigado obrigada olá como onde quando porque",
  fr: "le la les et est un une des du que qui je tu il elle nous vous ils pas oui non très mais avec pour dans sur ce cette c'est être avoir bien aussi maintenant ici bonjour merci comment pourquoi quand où",
  de: "der die das und ist ein eine nicht ich du er sie wir ihr mit für auf aber ja nein sehr auch jetzt hier wie warum wann wo was gut danke hallo haben sein dass oder schon noch",
  it: "il lo la gli le e è un una che di non sono sei siamo io tu lui lei noi voi con per ma sì molto anche bene adesso qui come perché quando dove cosa grazie ciao questo questa",
  nl: "de het een en is niet ik jij je hij zij wij met voor op maar ja nee heel ook nu hier hoe waarom wanneer waar wat goed dank hallo zijn hebben dat of nog al",
};

const commonWordSets = new Map<string, Set<string>>();
function commonWords(code: string): Set<string> | null {
  const list = COMMON_WORDS[code];
  if (!list) return null;
  let set = commonWordSets.get(code);
  if (!set) {
    set = new Set(list.split(" "));
    commonWordSets.set(code, set);
  }
  return set;
}

/** Words that are only on one language's list, for each language of a pair. */
function splitByCommonWords(
  text: string,
  learning: Set<string>,
  other: Set<string>,
): { learning: number; other: number } {
  let inLearning = 0;
  let inOther = 0;
  for (const word of text.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    const a = learning.has(word);
    const b = other.has(word);
    if (a && !b) inLearning++;
    else if (b && !a) inOther++;
  }
  return { learning: inLearning, other: inOther };
}

/** Below this share of speech told apart, the stat is a guess, so it isn't shown. */
const MIN_TOLD_APART = 0.25;

/**
 * How much of the lesson was in the language being learned, and how long the
 * student spoke it. Word timings in lesson transcripts are spread evenly over
 * each line, so a line's time is split by syllables (or by common words, when
 * both languages use Latin letters). Null when it can't be told.
 */
export function computeLanguageStats(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf = lessonRoles(segments, null),
  { learning, explainIn }: { learning: string; explainIn: string } = {
    learning: "zh",
    explainIn: "en",
  },
): LessonLanguageStats | null {
  const learningFacts = languageFacts(learning);
  const otherFacts = languageFacts(explainIn);
  if (learningFacts.code === otherFacts.code) return null;
  const byScript =
    learningFacts.script !== "latin" &&
    learningFacts.script !== otherFacts.script;
  const learningWords = byScript ? null : commonWords(learningFacts.code);
  const otherWords = byScript ? null : commonWords(otherFacts.code);
  if (!byScript && (!learningWords || !otherWords)) return null;

  let allMs = 0;
  let spokenMs = 0;
  let inLanguageMs = 0;
  let studentInLanguageMs = 0;
  for (const segment of segments) {
    const duration = speakingMs(segment);
    if (duration === 0 || !segment.text.trim()) continue;
    allMs += duration;
    const split = byScript
      ? splitByScript(segment.text, learning)
      : splitByCommonWords(segment.text, learningWords!, otherWords!);
    const total = split.learning + split.other;
    if (total === 0) continue;
    const inLanguage = (duration * split.learning) / total;
    spokenMs += duration;
    inLanguageMs += inLanguage;
    if (roleOf(segment) === "student") studentInLanguageMs += inLanguage;
  }
  if (inLanguageMs === 0 || spokenMs < allMs * MIN_TOLD_APART) return null;
  return {
    spokenMs: Math.round(spokenMs),
    inLanguageMs: Math.round(inLanguageMs),
    studentInLanguageMs: Math.round(studentInLanguageMs),
  };
}

export function languageShare(stats: LessonLanguageStats): number {
  return Math.round((stats.inLanguageMs / stats.spokenMs) * 100);
}

/** The Chinese share as before languages were set. */
export function computeChineseStats(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf = lessonRoles(segments, null),
): LessonChineseStats | null {
  const stats = computeLanguageStats(segments, roleOf, {
    learning: "zh",
    explainIn: "en",
  });
  return stats
    ? {
        spokenMs: stats.spokenMs,
        chineseMs: stats.inLanguageMs,
        studentChineseMs: stats.studentInLanguageMs,
      }
    : null;
}

export function chineseShare(stats: LessonChineseStats): number {
  return Math.round((stats.chineseMs / stats.spokenMs) * 100);
}
