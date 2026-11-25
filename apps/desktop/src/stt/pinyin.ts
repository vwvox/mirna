import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

/**
 * Pinyin over Chinese characters in transcripts, generated on this Mac from
 * the characters (pinyin-pro, which reads 便宜 as pián yi and 出差 as chū chāi
 * from context). Speech engines' own romanisation is unreliable, so Mirna
 * never asks them for it.
 */

const STORAGE_KEY = "mirna:transcript-pinyin";
const HAN = /\p{Script=Han}/u;
const HAN_ONLY = /^\p{Script=Han}+$/u;

export const CHINESE_DISPLAY_MODES = [
  "characters",
  "pinyin-above",
  "word-by-word",
  "pinyin-only",
] as const;
export type ChineseDisplayMode = (typeof CHINESE_DISPLAY_MODES)[number];

export type ChineseDisplay = {
  mode: ChineseDisplayMode;
  toneColours: boolean;
  translation: boolean;
};

const DEFAULT_DISPLAY: ChineseDisplay = {
  mode: "characters",
  toneColours: false,
  translation: false,
};

export function parseChineseDisplay(
  raw: string | null | undefined,
): ChineseDisplay {
  // The first version stored only whether pinyin was on, as "1" or "0".
  if (raw === "1") return { ...DEFAULT_DISPLAY, mode: "pinyin-above" };
  if (!raw || raw === "0") return DEFAULT_DISPLAY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_DISPLAY;
    const value = parsed as Record<string, unknown>;
    return {
      mode:
        CHINESE_DISPLAY_MODES.find((mode) => mode === value.mode) ??
        DEFAULT_DISPLAY.mode,
      toneColours: value.toneColours === true,
      translation: value.translation === true,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** Lessons read best with pinyin over the characters, in tone colours. */
export const LESSON_DISPLAY: ChineseDisplay = {
  mode: "pinyin-above",
  toneColours: true,
  translation: false,
};

function readStored(): ChineseDisplay & { chosen: boolean } {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return { ...parseChineseDisplay(raw), chosen: raw != null };
  } catch {
    return { ...DEFAULT_DISPLAY, chosen: false };
  }
}

type ChineseDisplayState = ChineseDisplay & {
  /** Whether the student has picked a display; until then lessons use LESSON_DISPLAY. */
  chosen: boolean;
  update: (patch: Partial<ChineseDisplay>) => void;
};

export const useChineseDisplay = create<ChineseDisplayState>((set, get) => ({
  ...readStored(),
  update: (patch) => {
    const { mode, toneColours, translation } = { ...get(), ...patch };
    const next = { mode, toneColours, translation };
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage; the choice still holds this session.
    }
    set({ ...next, chosen: true });
  },
}));

/** The display a note uses: the student's pick, or the lesson default until they pick one. */
export function effectiveChineseDisplay(
  state: ChineseDisplay & { chosen: boolean },
  isLesson: boolean,
): ChineseDisplay {
  if (!state.chosen && isLesson) {
    return { ...LESSON_DISPLAY, translation: state.translation };
  }
  return {
    mode: state.mode,
    toneColours: state.toneColours,
    translation: state.translation,
  };
}

export function useEffectiveChineseDisplay(isLesson: boolean): ChineseDisplay {
  const mode = useChineseDisplay((state) => state.mode);
  const toneColours = useChineseDisplay((state) => state.toneColours);
  const translation = useChineseDisplay((state) => state.translation);
  const chosen = useChineseDisplay((state) => state.chosen);
  return useMemo(
    () =>
      effectiveChineseDisplay(
        { mode, toneColours, translation, chosen },
        isLesson,
      ),
    [chosen, isLesson, mode, toneColours, translation],
  );
}

export const CJK_FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';

/** Tones 1–4 and the neutral tone (0), each with a lighter shade for dark mode. */
export const TONE_CLASSES: Readonly<Record<number, string>> = {
  0: "text-[#666D68] dark:text-[#A3AAA5]",
  1: "text-[#B4532F] dark:text-[#E58A66]",
  2: "text-[#2F7A47] dark:text-[#6FC08A]",
  3: "text-[#2B5C9E] dark:text-[#7EA6DE]",
  4: "text-[#7A3B8C] dark:text-[#C08AD0]",
};

export function toneClass(tone: number): string {
  return TONE_CLASSES[tone] ?? TONE_CLASSES[0]!;
}

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

export type PinyinPart = { text: string; pinyin?: string };

type PinyinModule = typeof import("pinyin-pro");
export type PinyinTools = Pick<
  PinyinModule,
  "pinyin" | "segment" | "OutputFormat"
>;
let pinyinModule: PinyinModule | null = null;
let loading: Promise<PinyinModule> | null = null;

function loadPinyin(): Promise<PinyinModule> {
  loading ??= import("pinyin-pro").then((module) => {
    pinyinModule = module;
    return module;
  });
  return loading;
}

/** The pinyin module if something already loaded it, for synchronous callers such as search. */
export function getLoadedPinyinModule(): PinyinModule | null {
  return pinyinModule;
}

/** Characters with their pinyin; everything else passes through in runs. */
export function annotatePinyin(
  text: string,
  module: Pick<PinyinModule, "pinyin">,
): PinyinPart[] {
  const parts: PinyinPart[] = [];
  for (const item of module.pinyin(text, { type: "all" })) {
    if (item.isZh && item.pinyin) {
      parts.push({ text: item.origin, pinyin: item.pinyin });
      continue;
    }
    const last = parts[parts.length - 1];
    if (last && last.pinyin === undefined) last.text += item.origin;
    else parts.push({ text: item.origin });
  }
  return parts;
}

/**
 * The pinyin module once something needs it; it's loaded only then, so
 * notes without Chinese don't pay for its dictionary.
 */
export function usePinyinModule(enabled: boolean): PinyinModule | null {
  const [module, setModule] = useState(pinyinModule);
  useEffect(() => {
    if (!enabled || module) return;
    let cancelled = false;
    void loadPinyin().then((loaded) => {
      if (!cancelled) setModule(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, module]);
  return enabled ? module : null;
}

export type HanSyllable = { pinyin: string; tone: number };

/** A Chinese word with one syllable per character, or a run of anything else. */
export type HanToken = {
  text: string;
  start: number;
  end: number;
  syllables: HanSyllable[] | null;
};

type WordSegmenter = { segment(text: string): Iterable<{ segment: string }> };
type WordSegmenterConstructor = new (
  locale: string,
  options: { granularity: "word" },
) => WordSegmenter;

let wordSegmenter: WordSegmenter | null | undefined;

function getWordSegmenter(): WordSegmenter | null {
  if (wordSegmenter !== undefined) return wordSegmenter;
  const Segmenter = (Intl as { Segmenter?: WordSegmenterConstructor })
    .Segmenter;
  wordSegmenter = Segmenter
    ? new Segmenter("zh-Hans", { granularity: "word" })
    : null;
  return wordSegmenter;
}

/**
 * pinyin-pro only groups words whose reading depends on them (喜欢, 便宜) and
 * leaves 我们 or 学习 as single characters, so the system's dictionary
 * segmenter splits words where it exists.
 */
function segmentPlainRun(run: string, tools: PinyinTools): string[] {
  const segmenter = getWordSegmenter();
  const words = segmenter
    ? Array.from(segmenter.segment(run), (part) => part.segment)
    : tools.segment(run, { format: tools.OutputFormat.ZhSegment });
  return words.join("") === run ? words : Array.from(run);
}

/** Lesson vocabulary goes first, longest match, so its words always stay whole. */
function segmentRun(
  run: string,
  tools: PinyinTools,
  terms: ReadonlySet<string>,
): string[] {
  if (terms.size === 0) return segmentPlainRun(run, tools);
  let longest = 0;
  for (const term of terms) longest = Math.max(longest, term.length);
  const words: string[] = [];
  let plainStart = 0;
  let index = 0;
  while (index < run.length) {
    let match = "";
    for (
      let length = Math.min(longest, run.length - index);
      length > 0;
      length--
    ) {
      const candidate = run.slice(index, index + length);
      if (terms.has(candidate)) {
        match = candidate;
        break;
      }
    }
    if (!match) {
      index += 1;
      continue;
    }
    if (index > plainStart) {
      words.push(...segmentPlainRun(run.slice(plainStart, index), tools));
    }
    words.push(match);
    index += match.length;
    plainStart = index;
  }
  if (plainStart < run.length) {
    words.push(...segmentPlainRun(run.slice(plainStart), tools));
  }
  return words;
}

/** Lesson vocabulary that can steer word splitting: whole Chinese words only. */
export function hanVocabularyTerms(terms: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const term of terms) {
    const trimmed = term.trim();
    if (HAN_ONLY.test(trimmed)) result.add(trimmed);
  }
  return result;
}

const NO_TERMS: ReadonlySet<string> = new Set<string>();
const ANALYSIS_CACHE_LIMIT = 20_000;
const analysisCache = new WeakMap<
  ReadonlySet<string>,
  Map<string, HanToken[]>
>();

/**
 * Chinese words with a syllable per character (read in context, so 便宜 is
 * pián yi) and everything between them as plain runs, covering the whole text.
 */
export function analyzeHan(
  text: string,
  tools: PinyinTools,
  terms: ReadonlySet<string> = NO_TERMS,
): HanToken[] {
  let cache = analysisCache.get(terms);
  if (!cache) {
    cache = new Map();
    analysisCache.set(terms, cache);
  }
  const cached = cache.get(text);
  if (cached) return cached;

  const characters = tools.pinyin(text, { type: "all" }).map((item) => ({
    text: item.origin,
    syllable:
      item.isZh && item.pinyin ? { pinyin: item.pinyin, tone: item.num } : null,
  }));
  const tokens: HanToken[] = [];
  if (characters.map((character) => character.text).join("") !== text) {
    tokens.push({ text, start: 0, end: text.length, syllables: null });
  } else {
    let offset = 0;
    let index = 0;
    while (index < characters.length) {
      const isHan = characters[index]!.syllable !== null;
      let end = index;
      let run = "";
      while (
        end < characters.length &&
        (characters[end]!.syllable !== null) === isHan
      ) {
        run += characters[end]!.text;
        end += 1;
      }
      if (isHan) {
        let characterIndex = index;
        for (const word of segmentRun(run, tools, terms)) {
          const syllables: HanSyllable[] = [];
          let consumed = 0;
          while (consumed < word.length && characterIndex < end) {
            const character = characters[characterIndex]!;
            syllables.push(character.syllable!);
            consumed += character.text.length;
            characterIndex += 1;
          }
          tokens.push({
            text: word,
            start: offset,
            end: offset + word.length,
            syllables,
          });
          offset += word.length;
        }
      } else {
        tokens.push({
          text: run,
          start: offset,
          end: offset + run.length,
          syllables: null,
        });
        offset += run.length;
      }
      index = end;
    }
  }

  if (cache.size >= ANALYSIS_CACHE_LIMIT) cache.clear();
  cache.set(text, tokens);
  return tokens;
}

/** "dōu" as typed without tones; ü can be typed as either v or u. */
export function tonelessPinyin(pinyin: string): string[] {
  const decomposed = pinyin.normalize("NFD").toLowerCase();
  const withU = decomposed.replace(/[̀-ͯ]/g, "");
  const withV = decomposed.replace(/ü/g, "v").replace(/[̀-ͯ]/g, "");
  return withV === withU ? [withU] : [withU, withV];
}

/** Whether a Chinese word's pinyin, typed without tones, contains (or is) the query. */
export function matchesPinyinQuery(
  syllables: readonly HanSyllable[],
  query: string,
  wholeWord: boolean,
): boolean {
  let spellings = [""];
  for (const syllable of syllables) {
    const options = tonelessPinyin(syllable.pinyin);
    spellings = spellings
      .flatMap((prefix) => options.map((option) => prefix + option))
      .slice(0, 8);
  }
  return spellings.some((spelling) =>
    wholeWord ? spelling === query : spelling.includes(query),
  );
}

/** A query that could be pinyin typed without tones (letters only, spaces ignored). */
export function toPinyinQuery(query: string): string | null {
  const compact = query.replace(/\s+/g, "");
  return /^[a-zü]+$/.test(compact) ? compact.replace(/ü/g, "v") : null;
}
