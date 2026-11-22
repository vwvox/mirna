import { Fragment, memo, useMemo } from "react";

import { cn } from "@anlg/utils";

import type { HighlightSegment } from "./utils";

import type { SegmentWord } from "~/stt/live-segment";
import {
  annotatePinyin,
  hasHan,
  usePinyinModule,
  usePinyinPreference,
} from "~/stt/pinyin";
import { isTranscriptWordSeekable } from "~/stt/timing";

interface WordSpanProps {
  word: SegmentWord;
  displayText: string;
  audioExists: boolean;
  onClickWord: (word: SegmentWord) => void;
  highlightSegments?: HighlightSegment[];
  isActiveMatch?: boolean;
}

export const WordSpan = memo(function WordSpan(props: WordSpanProps) {
  const highlighted = useHighlightedContent(
    props.word,
    props.displayText,
    props.highlightSegments,
    props.isActiveMatch ?? false,
  );
  // Search highlighting wins over pinyin, so matches stay visible.
  const wantsPinyin =
    usePinyinPreference((state) => state.show) &&
    !props.highlightSegments &&
    hasHan(props.displayText);
  const pinyin = usePinyinModule(wantsPinyin);
  const content = useMemo(
    () =>
      pinyin
        ? annotatePinyin(props.displayText, pinyin).map((part, index) =>
            part.pinyin ? (
              <ruby key={index} className="mx-[0.12em]">
                {part.text}
                <rt className="text-muted-foreground text-[0.72em] font-normal tracking-normal">
                  {part.pinyin}
                </rt>
              </ruby>
            ) : (
              <Fragment key={index}>{part.text}</Fragment>
            ),
          )
        : highlighted,
    [highlighted, pinyin, props.displayText],
  );
  const canSeek = props.audioExists && isTranscriptWordSeekable(props.word);
  const className = useMemo(
    () =>
      cn([
        canSeek && "hover:bg-accent/60 cursor-pointer",
        !props.word.is_final && ["opacity-60", "italic"],
      ]),
    [canSeek, props.word.is_final],
  );

  return (
    <span
      onClick={() => canSeek && props.onClickWord(props.word)}
      className={className}
      data-transcript-word-id={props.word.id}
      data-transcript-word-start-ms={props.word.start_ms}
    >
      {content}
    </span>
  );
});

function useHighlightedContent(
  word: SegmentWord,
  displayText: string,
  segments: HighlightSegment[] | undefined,
  isActive: boolean,
) {
  return useMemo(() => {
    if (!segments) {
      return displayText;
    }

    const baseKey = word.id ?? word.text ?? "word";

    return segments.map((segment, index) =>
      segment.isMatch ? (
        <span
          key={`${baseKey}-match-${index}`}
          className={isActive ? "bg-yellow-500" : "bg-yellow-200/50"}
        >
          {segment.text}
        </span>
      ) : (
        <Fragment key={`${baseKey}-text-${index}`}>{segment.text}</Fragment>
      ),
    );
  }, [displayText, isActive, segments, word.id, word.text]);
}
