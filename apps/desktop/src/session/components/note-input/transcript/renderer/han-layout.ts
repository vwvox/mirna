import { joinWordTexts } from "./utils";

import {
  analyzeHan,
  hasHan,
  type HanSyllable,
  type HanToken,
  matchesPinyinQuery,
  type PinyinTools,
} from "~/stt/pinyin";

/** A sentence of transcript words read as Chinese: where each word sits in the joined text, and its words. */
export type HanLine = {
  texts: readonly string[];
  starts: number[];
  text: string;
  tokens: HanToken[];
};

export type HanGlyph = {
  text: string;
  syllable?: HanSyllable;
  /** In pinyin-only text, a space goes before a word that doesn't follow one. */
  spaceBefore?: boolean;
};

export type HanPiece = { wordIndex: number | null; text: string };

const NO_SPACE_AFTER = /[\s([{“‘「『（《〈【，。！？：；、]/u;

export function layoutHanLine(
  texts: readonly string[],
  tools: PinyinTools,
  terms?: ReadonlySet<string>,
): HanLine | null {
  if (!texts.some(hasHan)) return null;
  const { text, starts } = joinWordTexts(texts);
  return { texts, starts, text, tokens: analyzeHan(text, tools, terms) };
}

function wordRange(line: HanLine, wordIndex: number) {
  const start = line.starts[wordIndex] ?? 0;
  return { start, end: start + (line.texts[wordIndex]?.length ?? 0) };
}

/** One word's share of the line: Chinese characters one by one with their syllables, anything else in runs. */
export function getWordGlyphs(line: HanLine, wordIndex: number): HanGlyph[] {
  const { start, end } = wordRange(line, wordIndex);
  const glyphs: HanGlyph[] = [];
  for (const token of line.tokens) {
    if (token.end <= start) continue;
    if (token.start >= end) break;
    if (!token.syllables) {
      glyphs.push({
        text: line.text.slice(
          Math.max(start, token.start),
          Math.min(end, token.end),
        ),
      });
      continue;
    }
    let position = token.start;
    Array.from(token.text).forEach((character, index) => {
      const at = position;
      position += character.length;
      if (at < start || at >= end) return;
      const previous = line.text[at - 1];
      glyphs.push({
        text: character,
        syllable: token.syllables![index],
        spaceBefore:
          at === token.start &&
          previous !== undefined &&
          !NO_SPACE_AFTER.test(previous),
      });
    });
  }
  return glyphs;
}

/** The words (or the plain text between them) that make up one token of the line. */
export function getTokenPieces(line: HanLine, token: HanToken): HanPiece[] {
  const pieces: HanPiece[] = [];
  let cursor = token.start;
  line.texts.forEach((_, wordIndex) => {
    const { start, end } = wordRange(line, wordIndex);
    if (end <= token.start || start >= token.end) return;
    const from = Math.max(start, token.start);
    if (from > cursor) {
      pieces.push({ wordIndex: null, text: line.text.slice(cursor, from) });
    }
    const to = Math.min(end, token.end);
    pieces.push({ wordIndex, text: line.text.slice(from, to) });
    cursor = to;
  });
  if (cursor < token.end) {
    pieces.push({ wordIndex: null, text: line.text.slice(cursor, token.end) });
  }
  return pieces;
}

/** For each Chinese word whose toneless pinyin matches, the transcript words it spans. */
export function findPinyinMatches(
  line: HanLine,
  query: string,
  wholeWord: boolean,
): number[][] {
  const matches: number[][] = [];
  for (const token of line.tokens) {
    if (
      !token.syllables ||
      !matchesPinyinQuery(token.syllables, query, wholeWord)
    ) {
      continue;
    }
    const wordIndexes = getTokenPieces(line, token).flatMap((piece) =>
      piece.wordIndex === null ? [] : [piece.wordIndex],
    );
    if (wordIndexes.length > 0) matches.push(wordIndexes);
  }
  return matches;
}

const FULL_WIDTH_PUNCTUATION: Record<string, string> = {
  "，": ", ",
  "。": ". ",
  "！": "! ",
  "？": "? ",
  "：": ": ",
  "；": "; ",
  "、": ", ",
};

/** Chinese punctuation set the way it reads in romanised text. */
export function romanisePunctuation(text: string): string {
  return text.replace(
    /[，。！？：；、]/gu,
    (mark) => FULL_WIDTH_PUNCTUATION[mark] ?? mark,
  );
}
