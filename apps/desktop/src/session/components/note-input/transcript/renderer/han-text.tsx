import { type CSSProperties, Fragment, type ReactNode } from "react";

import { cn } from "@anlg/utils";

import { type HanGlyph, romanisePunctuation } from "./han-layout";

import {
  type ChineseDisplayMode,
  CJK_FONT_STACK,
  type HanSyllable,
  toneClass,
} from "~/stt/pinyin";

export const HAN_STYLE: CSSProperties = { fontFamily: CJK_FONT_STACK };
export const HAN_CLASS = "text-[1.1em]";

// Chinese characters and the full-width punctuation that sits between them.
const HAN_RUN = /[\p{Script=Han}　-〿＀-￯]+/gu;

/** Plain text with its Chinese runs set in a Chinese face, slightly larger, and marked as Chinese. */
export function renderHanRuns(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(HAN_RUN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <span key={index} lang="zh-Hans" className={HAN_CLASS} style={HAN_STYLE}>
        {match[0]}
      </span>,
    );
    cursor = index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function toneText(
  text: string,
  tone: number | undefined,
  toneColours: boolean,
  key: number,
): ReactNode {
  return toneColours && tone !== undefined ? (
    <span key={key} className={toneClass(tone)}>
      {text}
    </span>
  ) : (
    text
  );
}

/** One transcript word's characters as the chosen display reads them. */
export function renderGlyphs(
  glyphs: readonly HanGlyph[],
  mode: ChineseDisplayMode,
  toneColours: boolean,
): ReactNode {
  const parts: ReactNode[] = [];
  let hanRun: ReactNode[] = [];
  const flushHan = () => {
    if (hanRun.length === 0) return;
    parts.push(
      <span
        key={`han-${parts.length}`}
        lang="zh-Hans"
        className={HAN_CLASS}
        style={HAN_STYLE}
      >
        {hanRun}
      </span>,
    );
    hanRun = [];
  };

  glyphs.forEach((glyph, index) => {
    const syllable = glyph.syllable;
    if (!syllable) {
      flushHan();
      parts.push(
        <Fragment key={index}>
          {mode === "pinyin-only"
            ? romanisePunctuation(glyph.text)
            : renderHanRuns(glyph.text)}
        </Fragment>,
      );
      return;
    }
    if (mode === "pinyin-only") {
      flushHan();
      parts.push(
        toneText(
          `${glyph.spaceBefore ? " " : ""}${syllable.pinyin}`,
          syllable.tone,
          toneColours,
          index,
        ),
      );
      return;
    }
    if (mode === "pinyin-above") {
      flushHan();
      parts.push(
        <ruby
          key={index}
          lang="zh-Hans"
          style={HAN_STYLE}
          className={cn([
            HAN_CLASS,
            "mx-[0.06em]",
            toneColours && toneClass(syllable.tone),
          ])}
        >
          {glyph.text}
          <rt
            className={cn([
              "text-[0.6em] font-normal tracking-normal",
              !toneColours && "text-muted-foreground",
            ])}
          >
            {syllable.pinyin}
          </rt>
        </ruby>,
      );
      return;
    }
    const part = toneText(glyph.text, syllable.tone, toneColours, index);
    const last = hanRun.length - 1;
    if (typeof part === "string" && typeof hanRun[last] === "string") {
      hanRun[last] += part;
    } else {
      hanRun.push(part);
    }
  });
  flushHan();
  return parts;
}

/** A Chinese word's pinyin, syllable by syllable, in tone colours when they're on. */
export function PinyinSyllables({
  syllables,
  toneColours,
}: {
  syllables: readonly HanSyllable[];
  toneColours: boolean;
}) {
  return (
    <>
      {syllables.map((syllable, index) =>
        toneText(syllable.pinyin, syllable.tone, toneColours, index),
      )}
    </>
  );
}

/** A Chinese word's characters in tone colours when they're on. */
export function HanCharacters({
  text,
  syllables,
  toneColours,
}: {
  text: string;
  syllables: readonly HanSyllable[];
  toneColours: boolean;
}) {
  return (
    <>
      {Array.from(text).map((character, index) =>
        toneText(character, syllables[index]?.tone, toneColours, index),
      )}
    </>
  );
}
