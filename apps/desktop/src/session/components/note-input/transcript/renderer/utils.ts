import chroma from "chroma-js";
import { type CSSProperties, useMemo } from "react";

import type { Segment, SegmentKey, SegmentWord } from "~/stt/live-segment";
import { isTranscriptWordSeekable } from "~/stt/timing";

export type HighlightSegment = { text: string; isMatch: boolean };

export type SentenceLine = {
  words: SegmentWord[];
  startMs: number;
  endMs: number;
};

type SegmentColorVars = CSSProperties & {
  "--segment-color-light": string;
  "--segment-color-dark": string;
};

// Chinese, Japanese and Korean characters and punctuation run on without spaces.
const CJK =
  /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/u;

/** The space between two words as displayed, or none between CJK text. */
export function wordSeparator(before: string, after: string): string {
  const end = before.trimEnd().slice(-1);
  const start = after.trimStart().slice(0, 1);
  return end && start && CJK.test(end) && CJK.test(start) ? "" : " ";
}

// Sentences end on Western or full-width Chinese punctuation.
const SENTENCE_END = /[.?!。？！]$/u;
export const PARAGRAPH_GAP_MS = 1500;

export type TranscriptParagraph = {
  lines: SentenceLine[];
  startMs: number;
  endMs: number;
};

function closesSentence(word: SegmentWord) {
  return SENTENCE_END.test(word.text.trim());
}

/** A pause longer than this between two timed words starts a new paragraph. */
function startsParagraph(previous: SegmentWord, next: SegmentWord) {
  return (
    isTranscriptWordSeekable(previous) &&
    isTranscriptWordSeekable(next) &&
    next.start_ms - previous.end_ms > PARAGRAPH_GAP_MS
  );
}

function toLine(words: SegmentWord[]): SentenceLine {
  return {
    words,
    startMs: words[0]!.start_ms,
    endMs: words[words.length - 1]!.end_ms,
  };
}

export function groupWordsIntoParagraphs(
  words: SegmentWord[],
): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let lines: SentenceLine[] = [];
  let currentLine: SegmentWord[] = [];
  const closeParagraph = () => {
    if (currentLine.length > 0) lines.push(toLine(currentLine));
    currentLine = [];
    if (lines.length === 0) return;
    paragraphs.push({
      lines,
      startMs: lines[0]!.startMs,
      endMs: lines[lines.length - 1]!.endMs,
    });
    lines = [];
  };

  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (previous && startsParagraph(previous, word)) closeParagraph();
    currentLine.push(word);
    if (closesSentence(word)) {
      lines.push(toLine(currentLine));
      currentLine = [];
    }
  });
  closeParagraph();
  return paragraphs;
}

export function groupWordsIntoLines(words: SegmentWord[]): SentenceLine[] {
  return groupWordsIntoParagraphs(words).flatMap(
    (paragraph) => paragraph.lines,
  );
}

export function getActiveLineIndex(
  words: SegmentWord[],
  offsetMs: number,
  currentMs: number,
): number | null {
  if (currentMs <= 0 || words.length === 0) return null;

  let lineIndex = 0;
  let lineStartMs = words[0]!.start_ms;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1];
    const closesLine =
      !next || closesSentence(word) || startsParagraph(word, next);

    if (!closesLine) {
      continue;
    }

    const start = offsetMs + lineStartMs;
    const end = offsetMs + word.end_ms;
    if (currentMs >= start && currentMs <= end) {
      return lineIndex;
    }

    lineIndex += 1;
    lineStartMs = next?.start_ms ?? lineStartMs;
  }

  return null;
}

/** Words joined as displayed, with where each word starts in the result. */
export function joinWordTexts(texts: readonly string[]): {
  text: string;
  starts: number[];
} {
  let text = "";
  const starts: number[] = [];
  texts.forEach((word, index) => {
    if (index > 0) text += wordSeparator(texts[index - 1]!, word);
    starts.push(text.length);
    text += word;
  });
  return { text, starts };
}

/**
 * The store matches edited text back to words by whitespace, so Chinese
 * shown without spaces gets them back at the original word boundaries; only
 * the words around the edit take its new text. `offset` (a position in
 * `edited`) moves with it.
 */
export function spaceEditedText(
  texts: readonly string[],
  edited: string,
  offset = 0,
): { text: string; offset: number } {
  const { text: original, starts } = joinWordTexts(texts);
  if (original === texts.join(" ")) return { text: edited, offset };

  const ends = starts.map((start, index) => start + texts[index]!.length);
  const limit = Math.min(original.length, edited.length);
  let prefix = 0;
  while (prefix < limit && original[prefix] === edited[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    original[original.length - 1 - suffix] ===
      edited[edited.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changeEnd = original.length - suffix;
  const delta = edited.length - original.length;

  let first = starts.findIndex(
    (start, index) => ends[index]! > prefix && start < changeEnd,
  );
  let last = first;
  if (first >= 0) {
    while (last + 1 < texts.length && starts[last + 1]! < changeEnd) last += 1;
  } else {
    first = last = starts.findIndex(
      (start, index) => start <= prefix && prefix <= ends[index]!,
    );
  }

  const parts: string[] = [];
  if (first < 0) {
    texts.forEach((word, index) => {
      if (ends[index]! <= prefix) parts.push(word);
    });
    parts.push(...edited.slice(prefix, edited.length - suffix).split(/\s+/));
    texts.forEach((word, index) => {
      if (starts[index]! >= changeEnd) parts.push(word);
    });
  } else {
    parts.push(...texts.slice(0, first));
    const middleStart = Math.min(starts[first]!, prefix);
    const middleEnd = Math.max(ends[last]!, changeEnd) + delta;
    parts.push(
      ...splitEditedWords(
        edited.slice(middleStart, middleEnd),
        texts.slice(first, last + 1),
      ),
    );
    parts.push(...texts.slice(last + 1));
  }
  const text = parts.filter(Boolean).join(" ");

  const visibleBefore = edited.slice(0, offset).replace(/\s+/g, "").length;
  let mapped = 0;
  for (let seen = 0; mapped < text.length && seen < visibleBefore; mapped++) {
    if (!/\s/.test(text[mapped]!)) seen += 1;
  }
  return { text, offset: mapped };
}

/** Gives each original word a piece of the edited text, cutting unspaced Chinese at the old word lengths. */
function splitEditedWords(edited: string, words: readonly string[]): string[] {
  const tokens = edited.trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= words.length) return tokens;
  const pieces: string[] = [];
  let wordIndex = 0;
  tokens.forEach((token, tokenIndex) => {
    let budget = words.length - wordIndex - (tokens.length - tokenIndex - 1);
    let rest = token;
    while (budget > 1 && wordIndex < words.length) {
      const length = words[wordIndex]!.length;
      if (
        rest.length <= length ||
        wordSeparator(rest.slice(0, length), rest.slice(length)) !== ""
      ) {
        break;
      }
      pieces.push(rest.slice(0, length));
      rest = rest.slice(length);
      wordIndex += 1;
      budget -= 1;
    }
    pieces.push(rest);
    wordIndex += 1;
  });
  return pieces;
}

const BACKCHANNEL_MAX_WORDS = 3;
const BACKCHANNEL_MAX_MS = 1500;

function isShortTurn(segment: Segment) {
  const words = segment.words;
  if (words.length === 0 || words.length > BACKCHANNEL_MAX_WORDS) return false;
  return (
    words[words.length - 1]!.end_ms - words[0]!.start_ms <= BACKCHANNEL_MAX_MS
  );
}

function sameSpeaker(left: SegmentKey, right: SegmentKey) {
  if (left.speaker_human_id || right.speaker_human_id) {
    return left.speaker_human_id === right.speaker_human_id;
  }
  return (
    left.channel === right.channel &&
    (left.speaker_index ?? null) === (right.speaker_index ?? null)
  );
}

/** Short replies ("Yeah.") between full turns by other people, shown as compact chips. */
export function findBackchannels(segments: readonly Segment[]): Set<number> {
  const indexes = new Set<number>();
  for (let index = 1; index < segments.length - 1; index += 1) {
    const previous = segments[index - 1]!;
    const segment = segments[index]!;
    const next = segments[index + 1]!;
    if (
      isShortTurn(segment) &&
      !isShortTurn(previous) &&
      !isShortTurn(next) &&
      !sameSpeaker(previous.key, segment.key) &&
      !sameSpeaker(next.key, segment.key)
    ) {
      indexes.add(index);
    }
  }
  return indexes;
}

/** Position in the recording as m:ss under an hour (zero-padded minutes) and h:mm:ss beyond. */
export function formatTranscriptTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** The avatar letter: a numbered speaker shows its number, anyone else their first letter. */
export function getSpeakerInitial(label: string): string {
  const trimmed = label.trim();
  const number = /\s(\d+)$/.exec(trimmed)?.[1];
  if (number) return number;
  const first = Array.from(trimmed)[0] ?? "?";
  return first.toLocaleUpperCase();
}

export function getSegmentColor(
  key: SegmentKey,
  mode: "light" | "dark" = "light",
): string {
  let speakerIndex = key.speaker_index ?? 0;
  if (key.speaker_human_id) {
    speakerIndex = 0;
    for (const character of key.speaker_human_id) {
      speakerIndex =
        (Math.imul(speakerIndex, 31) + character.charCodeAt(0)) >>> 0;
    }
  }

  const channelOffset = key.speaker_human_id
    ? 0
    : key.channel === "RemoteParty"
      ? 180
      : 0;
  // Golden-angle spacing keeps consecutive speakers visually distinct.
  const hue = (10 + speakerIndex * 137.508 + channelOffset) % 360;

  return chroma.oklch(mode === "dark" ? 0.72 : 0.55, 0.15, hue).hex();
}

export function getSegmentColorVars(key: SegmentKey): SegmentColorVars {
  return {
    "--segment-color-light": getSegmentColor(key),
    "--segment-color-dark": getSegmentColor(key, "dark"),
  };
}

export function useSegmentColorVars(key: SegmentKey): SegmentColorVars {
  return useMemo(() => getSegmentColorVars(key), [key]);
}
