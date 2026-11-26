import { Fragment, memo, useMemo } from "react";

import { cn } from "@anlg/utils";

import type { HanGlyph } from "./han-layout";
import { renderGlyphs, renderHanRuns } from "./han-text";
import type { HighlightSegment } from "./utils";

import type { SegmentWord } from "~/stt/live-segment";
import type { ChineseDisplayMode } from "~/stt/pinyin";
import { isTranscriptWordSeekable } from "~/stt/timing";

interface WordSpanProps {
  word: SegmentWord;
  displayText: string;
  audioExists: boolean;
  onClickWord: (word: SegmentWord) => void;
  highlightSegments?: HighlightSegment[];
  isActiveMatch?: boolean;
  /** The word's Chinese characters with their pinyin, once its line has been read. */
  glyphs?: readonly HanGlyph[] | null;
  mode?: ChineseDisplayMode;
  toneColours?: boolean;
}

export const WordSpan = memo(function WordSpan(props: WordSpanProps) {
  const highlighted = useHighlightedContent(
    props.word,
    props.displayText,
    props.highlightSegments,
    props.isActiveMatch ?? false,
  );
  const mode = props.mode ?? "characters";
  const toneColours = props.toneColours ?? false;
  // Search highlighting wins over pinyin, so matches stay visible.
  const content = useMemo(() => {
    if (props.highlightSegments) return highlighted;
    if (props.glyphs) return renderGlyphs(props.glyphs, mode, toneColours);
    return renderHanRuns(props.displayText);
  }, [
    highlighted,
    mode,
    props.displayText,
    props.glyphs,
    props.highlightSegments,
    toneColours,
  ]);
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
      title={
        mode === "pinyin-only" && props.glyphs && !props.highlightSegments
          ? props.displayText
          : undefined
      }
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
          {renderHanRuns(segment.text)}
        </span>
      ) : (
        <Fragment key={`${baseKey}-text-${index}`}>
          {renderHanRuns(segment.text)}
        </Fragment>
      ),
    );
  }, [displayText, isActive, segments, word.id, word.text]);
}
