import { useMemo } from "react";

import { cn } from "@anlg/utils";

import { useLessonLanguage } from "../language-context";
import { languageFacts, usesPinyin } from "../languages";
import { type ReadPart, readTerm } from "../tones";

import {
  CJK_FONT_STACK,
  hasHan,
  toneClass,
  useEffectiveChineseDisplay,
  usePinyinModule,
} from "~/stt/pinyin";

type Part = ReadPart;

/**
 * A word in the language being learned. Chinese follows the display picked for
 * lessons (Display in a transcript, or on the study sheet and course page): pinyin
 * above the characters, pinyin only or characters alone, in tone colours when on.
 * `pinyin` and `toneColours` override it, as practice does before the answer.
 */
export function LessonTerm({
  term,
  reading,
  className,
  toneColours,
  pinyin,
}: {
  term: string;
  /** The study sheet's pinyin for the word, which corrects the dictionary's. */
  reading?: string;
  className?: string;
  toneColours?: boolean;
  pinyin?: boolean;
}) {
  const display = useEffectiveChineseDisplay(true);
  const language = useLessonLanguage();
  // Japanese kanji are Han characters too, but pinyin belongs to Mandarin.
  const han = hasHan(term) && usesPinyin(language);
  const mode =
    pinyin === undefined
      ? display.mode
      : pinyin
        ? "pinyin-above"
        : "characters";
  const showPinyin = mode !== "characters";
  const colours = toneColours ?? display.toneColours;
  const tools = usePinyinModule(han && (colours || showPinyin));
  const parts = useMemo<Part[] | null>(
    () => (tools && han ? readTerm(term, tools, reading) : null),
    [han, reading, term, tools],
  );

  const colourOf = (part: Part) =>
    colours && part.tone !== null ? toneClass(part.tone) : undefined;

  if (parts && mode === "pinyin-only") {
    return (
      <span title={term} className={cn([className])}>
        {parts.map((part, index) =>
          part.tone === null ? (
            <span key={index}>{part.text}</span>
          ) : (
            <span key={index} className={colourOf(part)}>
              {part.pinyin}
              {index < parts.length - 1 && parts[index + 1]!.tone !== null
                ? " "
                : ""}
            </span>
          ),
        )}
      </span>
    );
  }

  if (!han && language) {
    return (
      <span
        lang={language}
        dir={languageFacts(language).rtl ? "rtl" : "auto"}
        className={cn([className])}
      >
        {term}
      </span>
    );
  }

  return (
    <span
      lang={han ? "zh-Hans" : undefined}
      className={cn([className])}
      style={han ? { fontFamily: CJK_FONT_STACK } : undefined}
    >
      {parts
        ? parts.map((part, index) =>
            part.tone !== null && showPinyin ? (
              <ruby key={index} className={colourOf(part)}>
                {part.text}
                <rt className="font-sans text-[0.45em] font-medium tracking-normal">
                  {part.pinyin}
                </rt>
              </ruby>
            ) : (
              <span key={index} className={colourOf(part)}>
                {part.text}
              </span>
            ),
          )
        : term}
    </span>
  );
}
