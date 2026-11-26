import { useLingui } from "@lingui/react/macro";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { Check, Copy, Play } from "@anlg/ui/components/icons";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@anlg/ui/components/ui/popover";
import { cn } from "@anlg/utils";

import {
  findPinyinMatches,
  getTokenPieces,
  getWordGlyphs,
  type HanGlyph,
  type HanLine,
  layoutHanLine,
} from "./han-layout";
import { HAN_STYLE, HanCharacters, PinyinSyllables } from "./han-text";
import { findParagraphTranslation, useTranscriptNote } from "./note-context";
import { SegmentHeader } from "./segment-header";
import {
  getTranscriptSectionKey,
  getTranscriptSegmentDomId,
} from "./selection";
import { useTranscriptSelectionState } from "./selection-context";
import {
  SpeakerAssignPopover,
  SpeakerParticipantPicker,
} from "./speaker-assign";
import {
  formatTranscriptTime,
  getActiveLineIndex,
  getSpeakerInitial,
  groupWordsIntoParagraphs,
  type HighlightSegment,
  joinWordTexts,
  type SentenceLine,
  spaceEditedText,
  type TranscriptParagraph,
  useSegmentColorVars,
  wordSeparator,
} from "./utils";
import { WordCardPopover, type WordCardTarget } from "./word-card";
import { WordSpan } from "./word-span";

import { createHighlightSegments } from "~/session/components/note-input/search/matching";
import type { Segment, SegmentWord } from "~/stt/live-segment";
import {
  type ChineseDisplayMode,
  hasHan,
  type HanToken,
  toPinyinQuery,
  useEffectiveChineseDisplay,
  usePinyinModule,
} from "~/stt/pinyin";
import {
  splitTranscriptSpeaker,
  updateTranscriptSegmentText,
} from "~/stt/queries";
import { isTranscriptWordSeekable } from "~/stt/timing";

export type TranscriptSearchRenderState = {
  query: string;
  activeMatchId: string | null;
  caseSensitive: boolean;
  wholeWord: boolean;
};

export const EMPTY_TRANSCRIPT_SEARCH: TranscriptSearchRenderState = {
  query: "",
  activeMatchId: null,
  caseSensitive: false,
  wholeWord: false,
};

/** A full speaker turn, or a short reply between someone else's turns shown as one compact line. */
export type SegmentVariant = "row" | "chip";

const SEGMENT_COLOR_CLASSES = [
  "[--segment-color:var(--segment-color-light)]",
  "dark:[--segment-color:var(--segment-color-dark)]",
];

function getSegmentTimeRange(
  segment: Segment,
  offsetMs: number,
): { start: number; end: number } | null {
  const words = segment.words;
  if (words.length === 0) return null;
  return {
    start: offsetMs + (words[0].start_ms ?? 0),
    end: offsetMs + (words[words.length - 1].end_ms ?? 0),
  };
}

function isWithin(range: { start: number; end: number } | null, ms: number) {
  return range !== null && ms > 0 && ms >= range.start && ms <= range.end;
}

export const SegmentRenderer = memo(
  ({
    segment,
    offsetMs,
    transcriptId,
    sessionId,
    speakerLabel,
    currentMs,
    seekAndPlay,
    audioExists,
    search,
    editMode = false,
    variant = "row",
  }: {
    segment: Segment;
    offsetMs: number;
    transcriptId: string;
    sessionId?: string;
    speakerLabel: string;
    currentMs: number;
    seekAndPlay: (word: SegmentWord) => void;
    audioExists: boolean;
    search: TranscriptSearchRenderState;
    editMode?: boolean;
    variant?: SegmentVariant;
  }) => {
    const paragraphs = useMemo(
      () => groupWordsIntoParagraphs(segment.words),
      [segment.words],
    );
    const { selectMode, isSelected } = useTranscriptSelectionState();
    const segmentId = getTranscriptSegmentDomId(transcriptId, segment);
    const selected = isSelected(
      getTranscriptSectionKey(transcriptId, segmentId),
    );
    const colorVars = useSegmentColorVars(segment.key);
    const { isLesson, vocabulary, vocabularyTerms, translations } =
      useTranscriptNote();
    const display = useEffectiveChineseDisplay(isLesson);
    const isChip = variant === "chip" && !editMode;
    const mode: ChineseDisplayMode =
      isChip && display.mode === "word-by-word" ? "pinyin-above" : display.mode;
    const segmentHasHan = useMemo(
      () => segment.words.some((word) => hasHan(word.text)),
      [segment.words],
    );
    const pinyinQuery = search.query
      ? toPinyinQuery(
          search.caseSensitive
            ? search.query.normalize("NFC")
            : search.query.normalize("NFC").toLowerCase(),
        )
      : null;
    const pinyinTools = usePinyinModule(
      segmentHasHan &&
        !editMode &&
        (mode !== "characters" || display.toneColours || pinyinQuery !== null),
    );
    const hanLines = useMemo(
      () =>
        pinyinTools
          ? paragraphs.map((paragraph) =>
              paragraph.lines.map((line) =>
                layoutHanLine(
                  line.words.map(getWordDisplayText),
                  pinyinTools,
                  vocabularyTerms,
                ),
              ),
            )
          : null,
      [paragraphs, pinyinTools, vocabularyTerms],
    );
    const glyphsByWord = useMemo(() => {
      const glyphs = new Map<SegmentWord, HanGlyph[]>();
      hanLines?.forEach((lines, paragraphIndex) =>
        lines.forEach((line, lineIndex) => {
          if (!line) return;
          paragraphs[paragraphIndex]!.lines[lineIndex]!.words.forEach(
            (word, wordIndex) => {
              glyphs.set(word, getWordGlyphs(line, wordIndex));
            },
          );
        }),
      );
      return glyphs;
    }, [hanLines, paragraphs]);
    const highlightSegmentsByWord = useMemo(() => {
      if (!search.query) {
        return null;
      }

      const highlights = new Map<SegmentWord, HighlightSegment[]>();
      for (const word of segment.words) {
        const displayText = getWordDisplayText(word);
        highlights.set(
          word,
          createHighlightSegments(
            displayText,
            search.query,
            search.caseSensitive,
            search.wholeWord,
          ),
        );
      }
      if (pinyinQuery && hanLines) {
        hanLines.forEach((lines, paragraphIndex) =>
          lines.forEach((line, lineIndex) => {
            if (!line) return;
            const words = paragraphs[paragraphIndex]!.lines[lineIndex]!.words;
            for (const match of findPinyinMatches(
              line,
              pinyinQuery,
              search.wholeWord,
            )) {
              for (const wordIndex of match) {
                const word = words[wordIndex]!;
                if (highlights.get(word)?.some((part) => part.isMatch)) {
                  continue;
                }
                highlights.set(word, [
                  { text: getWordDisplayText(word), isMatch: true },
                ]);
              }
            }
          }),
        );
      }
      return highlights;
    }, [
      hanLines,
      paragraphs,
      pinyinQuery,
      search.caseSensitive,
      search.query,
      search.wholeWord,
      segment.words,
    ]);
    const paragraphTranslations = useMemo(() => {
      if (!display.translation || translations.size === 0 || !segmentHasHan) {
        return null;
      }
      return paragraphs.map((paragraph) =>
        findParagraphTranslation(paragraph, translations),
      );
    }, [display.translation, paragraphs, segmentHasHan, translations]);
    const [card, setCard] = useState<WordCardTarget | null>(null);
    const range = getSegmentTimeRange(segment, offsetMs);
    const isPlayingRow = audioExists && isWithin(range, currentMs);
    const lineProps: LineRenderProps = {
      audioExists,
      currentMs,
      offsetMs,
      seekAndPlay,
      activeMatchId: search.activeMatchId,
      highlightSegmentsByWord,
      glyphsByWord,
      mode,
      toneColours: display.toneColours,
      vocabulary,
      onOpenCard: setCard,
    };

    const sectionProps = {
      "data-transcript-id": transcriptId,
      "data-transcript-segment-id": segmentId,
      "data-session-id": sessionId,
      "data-segment-channel": segment.key.channel,
      "data-segment-speaker-index": segment.key.speaker_index ?? "",
      "data-segment-speaker-human-id": segment.key.speaker_human_id ?? "",
      "data-transcript-offset-ms": offsetMs,
      "data-transcript-selected": selected ? "true" : undefined,
      "data-transcript-playing": isPlayingRow ? "true" : undefined,
      style: colorVars,
    };
    const sectionClassName = cn([
      "group/row relative flex gap-3 rounded-xl px-2 transition-colors",
      SEGMENT_COLOR_CLASSES,
      isPlayingRow && "bg-mirna-moss/55 dark:bg-mirna-serra/30",
      selectMode ? "cursor-pointer" : null,
      "data-[transcript-selected=true]:bg-primary/10 data-[transcript-selected=true]:ring-primary/30 data-[transcript-selected=true]:ring-1 data-[transcript-selected=true]:ring-inset",
    ]);

    if (isChip) {
      return (
        <section
          {...sectionProps}
          data-transcript-variant="chip"
          className={cn([sectionClassName, "items-start py-0.5"])}
        >
          <span aria-hidden className="w-12 shrink-0" />
          <span aria-hidden className="w-7 shrink-0" />
          <div className="bg-muted/70 dark:bg-muted/40 rounded-pill inline-flex max-w-full min-w-0 flex-wrap items-baseline gap-x-1 px-2.5 py-0.5 text-[13px] leading-5">
            <SpeakerAssignPopover
              segment={segment}
              transcriptId={transcriptId}
              sessionId={sessionId}
              color="var(--segment-color)"
              label={speakerLabel}
              className="my-0 py-0 pr-0 font-semibold"
            />
            <span aria-hidden className="text-muted-foreground -ml-1">
              :
            </span>
            <span
              data-transcript-segment-content
              className={cn([
                "text-foreground/85 min-w-0 wrap-break-word",
                selectMode ? "select-none" : "select-text-deep",
              ])}
            >
              {paragraphs.map((paragraph, paragraphIndex) => (
                <Fragment
                  key={paragraph.lines[0]?.words[0]?.id ?? paragraphIndex}
                >
                  {paragraphIndex > 0 ? " " : null}
                  <ParagraphLines
                    paragraph={paragraph}
                    hanLines={null}
                    {...lineProps}
                  />
                </Fragment>
              ))}
            </span>
          </div>
        </section>
      );
    }

    return (
      <section {...sectionProps} className={cn([sectionClassName, "py-2"])}>
        <time
          dateTime={range ? `PT${Math.floor(range.start / 1000)}S` : undefined}
          data-transcript-time={range ? formatTranscriptTime(range.start) : ""}
          className="text-muted-foreground w-12 shrink-0 pt-px text-right font-mono text-[11px] leading-5 tabular-nums before:content-[attr(data-transcript-time)]"
        />
        <span
          aria-hidden
          data-transcript-avatar={getSpeakerInitial(speakerLabel)}
          className="rounded-pill mt-px flex size-7 shrink-0 items-center justify-center bg-(--segment-color-light) text-[12px] font-semibold text-white before:content-[attr(data-transcript-avatar)]"
        />
        <div className="min-w-0 flex-1">
          <SegmentHeader
            segment={segment}
            transcriptId={transcriptId}
            sessionId={sessionId}
            label={speakerLabel}
            selected={selected}
          />

          {editMode ? (
            <EditableSegmentText
              segment={segment}
              transcriptId={transcriptId}
              sessionId={sessionId}
            />
          ) : (
            <div
              data-transcript-segment-content
              className={cn([
                "overflow-wrap-anywhere mt-0.5 flex flex-col gap-2 text-[15px] leading-relaxed wrap-break-word",
                selectMode ? "select-none" : "select-text-deep",
              ])}
            >
              {paragraphs.map((paragraph, paragraphIndex) => {
                const lines = hanLines?.[paragraphIndex] ?? null;
                const translation = paragraphTranslations?.[paragraphIndex];
                return (
                  <Fragment
                    key={paragraph.lines[0]?.words[0]?.id ?? paragraphIndex}
                  >
                    <p
                      className={cn([
                        lines?.some(Boolean) &&
                          mode === "pinyin-above" &&
                          "leading-[2.5]",
                        lines?.some(Boolean) &&
                          mode === "word-by-word" &&
                          "leading-[2.1]",
                      ])}
                    >
                      <ParagraphLines
                        paragraph={paragraph}
                        hanLines={lines}
                        {...lineProps}
                      />
                    </p>
                    {translation ? (
                      <p
                        data-transcript-translation
                        className="text-muted-foreground -mt-1 text-[13px] leading-5 italic"
                      >
                        {translation}
                      </p>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
        {selectMode ? null : (
          <RowActions
            segment={segment}
            audioExists={audioExists}
            seekAndPlay={seekAndPlay}
          />
        )}
        {card ? (
          <WordCardPopover
            target={card}
            toneColours={display.toneColours}
            canPlay={audioExists}
            onPlay={seekAndPlay}
            onClose={() => setCard(null)}
          />
        ) : null}
      </section>
    );
  },
  (prev, next) => {
    if (
      prev.segment !== next.segment ||
      prev.offsetMs !== next.offsetMs ||
      prev.transcriptId !== next.transcriptId ||
      prev.sessionId !== next.sessionId ||
      prev.speakerLabel !== next.speakerLabel ||
      prev.audioExists !== next.audioExists ||
      prev.seekAndPlay !== next.seekAndPlay ||
      prev.editMode !== next.editMode ||
      prev.variant !== next.variant
    ) {
      return false;
    }

    if (!canReuseSegmentForSearch(prev, next)) {
      return false;
    }

    if (prev.currentMs === next.currentMs) return true;

    const range = getSegmentTimeRange(prev.segment, prev.offsetMs);
    if (!range) return true;

    const prevInRange = isWithin(range, prev.currentMs);
    const nextInRange = isWithin(range, next.currentMs);

    if (!prevInRange && !nextInRange) return true;

    return (
      prevInRange === nextInRange &&
      getActiveLineIndex(prev.segment.words, prev.offsetMs, prev.currentMs) ===
        getActiveLineIndex(next.segment.words, next.offsetMs, next.currentMs)
    );
  },
);

type LineRenderProps = {
  audioExists: boolean;
  currentMs: number;
  offsetMs: number;
  seekAndPlay: (word: SegmentWord) => void;
  activeMatchId: string | null;
  highlightSegmentsByWord: Map<SegmentWord, HighlightSegment[]> | null;
  glyphsByWord: Map<SegmentWord, HanGlyph[]>;
  mode: ChineseDisplayMode;
  toneColours: boolean;
  vocabulary: ReadonlyMap<string, { meaning: string }>;
  onOpenCard: (target: WordCardTarget) => void;
};

function ParagraphLines({
  paragraph,
  hanLines,
  ...props
}: LineRenderProps & {
  paragraph: TranscriptParagraph;
  hanLines: readonly (HanLine | null)[] | null;
}) {
  return paragraph.lines.map((line, lineIndex) => {
    const lineStartMs = props.offsetMs + line.startMs;
    const lineEndMs = props.offsetMs + line.endMs;
    const isCurrentLine =
      props.audioExists &&
      props.currentMs > 0 &&
      props.currentMs >= lineStartMs &&
      props.currentMs <= lineEndMs;
    const previousLine = paragraph.lines[lineIndex - 1];
    const hanLine = hanLines?.[lineIndex] ?? null;
    const asColumns =
      props.mode === "word-by-word" &&
      hanLine !== null &&
      !props.highlightSegmentsByWord;

    return (
      <span
        key={line.words[0]?.id ?? `line-${lineIndex}`}
        data-line-current={isCurrentLine ? "true" : undefined}
        className={cn([
          "-mx-0.5 rounded-xs box-decoration-clone px-0.5",
          isCurrentLine && "bg-mirna-ipe/25 dark:bg-mirna-ipe/20",
        ])}
      >
        {previousLine
          ? wordSeparator(
              getWordDisplayText(
                previousLine.words[previousLine.words.length - 1]!,
              ),
              getWordDisplayText(line.words[0]!),
            )
          : null}
        {asColumns ? (
          <WordByWordLine line={line} hanLine={hanLine} {...props} />
        ) : (
          line.words.map((word, index) => (
            <Fragment key={word.id ?? `${word.start_ms}-${index}`}>
              {index > 0
                ? wordSeparator(
                    getWordDisplayText(line.words[index - 1]!),
                    getWordDisplayText(word),
                  )
                : null}
              <LineWord word={word} {...props} />
            </Fragment>
          ))
        )}
      </span>
    );
  });
}

function LineWord({
  word,
  displayText = getWordDisplayText(word),
  glyphs,
  ...props
}: LineRenderProps & {
  word: SegmentWord;
  displayText?: string;
  glyphs?: readonly HanGlyph[] | null;
}) {
  return (
    <WordSpan
      word={word}
      displayText={displayText}
      audioExists={props.audioExists}
      onClickWord={props.seekAndPlay}
      highlightSegments={props.highlightSegmentsByWord?.get(word) ?? undefined}
      isActiveMatch={Boolean(word.id) && word.id === props.activeMatchId}
      glyphs={glyphs === undefined ? props.glyphsByWord.get(word) : glyphs}
      mode={props.mode}
      toneColours={props.toneColours}
    />
  );
}

const CJK_PUNCTUATION = /^[\u3000-\u303f\uff00-\uff65]/;

/** Each Chinese word as a column of characters, pinyin and (from the lesson sheet) its meaning. */
function WordByWordLine({
  line,
  hanLine,
  ...props
}: LineRenderProps & { line: SentenceLine; hanLine: HanLine }) {
  return hanLine.tokens.map((token, tokenIndex) => {
    const pieces = getTokenPieces(hanLine, token);
    if (!token.syllables) {
      const content = pieces.map((piece, index) =>
        piece.wordIndex === null ? (
          <Fragment key={index}>{piece.text}</Fragment>
        ) : (
          <LineWord
            key={index}
            word={line.words[piece.wordIndex]!}
            displayText={piece.text}
            glyphs={null}
            {...props}
          />
        ),
      );
      // Full-width punctuation belongs to the word before it, not in a column of its own.
      const followsColumn = Boolean(hanLine.tokens[tokenIndex - 1]?.syllables);
      return followsColumn && CJK_PUNCTUATION.test(token.text) ? (
        <span key={token.start} data-han-punctuation className="-ml-[0.3em]">
          {content}
        </span>
      ) : (
        <Fragment key={token.start}>{content}</Fragment>
      );
    }
    return (
      <HanWordColumn
        key={token.start}
        token={token}
        words={pieces.map((piece) =>
          piece.wordIndex === null ? null : line.words[piece.wordIndex]!,
        )}
        texts={pieces.map((piece) => piece.text)}
        meaning={props.vocabulary.get(token.text)?.meaning.trim() ?? ""}
        toneColours={props.toneColours}
        onOpenCard={props.onOpenCard}
      />
    );
  });
}

function HanWordColumn({
  token,
  words,
  texts,
  meaning,
  toneColours,
  onOpenCard,
}: {
  token: HanToken;
  words: (SegmentWord | null)[];
  texts: string[];
  meaning: string;
  toneColours: boolean;
  onOpenCard: (target: WordCardTarget) => void;
}) {
  const syllables = token.syllables ?? [];
  const open = (anchor: HTMLElement) =>
    onOpenCard({
      term: token.text,
      syllables,
      word: words.find((word) => word !== null) ?? null,
      anchor,
    });
  let offset = 0;

  return (
    <span
      role="button"
      tabIndex={0}
      data-han-word={token.text}
      onClick={(event) => open(event.currentTarget)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(event.currentTarget);
      }}
      className="hover:bg-accent/60 focus-visible:ring-ring mx-[0.15em] inline-flex cursor-pointer flex-col items-center rounded-md px-[0.15em] align-baseline outline-none focus-visible:ring-1"
    >
      <span
        lang="zh-Hans"
        style={HAN_STYLE}
        className="text-[1.1em] leading-snug"
      >
        {texts.map((text, index) => {
          const length = Array.from(text).length;
          const pieceSyllables = syllables.slice(offset, offset + length);
          offset += length;
          const word = words[index];
          const characters = (
            <HanCharacters
              text={text}
              syllables={pieceSyllables}
              toneColours={toneColours}
            />
          );
          return word ? (
            <span
              key={index}
              data-transcript-word-id={word.id}
              data-transcript-word-start-ms={word.start_ms}
              className={cn([!word.is_final && ["opacity-60", "italic"]])}
            >
              {characters}
            </span>
          ) : (
            <Fragment key={index}>{characters}</Fragment>
          );
        })}
      </span>
      <span
        className={cn([
          "text-[11px] leading-4 whitespace-nowrap",
          !toneColours && "text-muted-foreground",
        ])}
      >
        <PinyinSyllables syllables={syllables} toneColours={toneColours} />
      </span>
      {meaning ? (
        <span className="text-muted-foreground max-w-28 truncate text-[10.5px] leading-4">
          {meaning}
        </span>
      ) : null}
    </span>
  );
}

function RowActions({
  segment,
  audioExists,
  seekAndPlay,
}: {
  segment: Segment;
  audioExists: boolean;
  seekAndPlay: (word: SegmentWord) => void;
}) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const firstPlayable = audioExists
    ? segment.words.find(isTranscriptWordSeekable)
    : undefined;
  const buttonClassName = cn([
    "text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-1",
  ]);

  return (
    <div
      data-transcript-row-actions
      className="bg-background/85 absolute top-1.5 right-1.5 flex gap-0.5 rounded-lg opacity-0 shadow-xs backdrop-blur-sm transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100"
    >
      {firstPlayable ? (
        <button
          type="button"
          aria-label={t`Play from here`}
          title={t`Play from here`}
          className={buttonClassName}
          onClick={() => seekAndPlay(firstPlayable)}
        >
          <Play aria-hidden className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t`Copy`}
        title={t`Copy`}
        className={buttonClassName}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(
              joinWordTexts(segment.words.map(getWordDisplayText)).text,
            )
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </button>
    </div>
  );
}

const EditableSegmentText = memo(function EditableSegmentText({
  segment,
  transcriptId,
  sessionId,
}: {
  segment: Segment;
  transcriptId: string;
  sessionId?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [speakerChange, setSpeakerChange] = useState<{
    text: string;
    offset: number;
  } | null>(null);
  const wordTexts = useMemo(
    () => segment.words.map(getWordDisplayText),
    [segment.words],
  );
  const originalText = normalizeEditableTranscriptText(
    joinWordTexts(wordTexts).text,
  );
  const wordIds = useMemo(
    () =>
      segment.words.flatMap((word) =>
        typeof word.id === "string" && word.id ? [word.id] : [],
      ),
    [segment.words],
  );
  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (speakerChange) return;
      const nextText = normalizeEditableTranscriptText(
        event.currentTarget.innerText ?? event.currentTarget.textContent ?? "",
      );
      if (nextText === originalText || wordIds.length === 0) {
        return;
      }

      void updateTranscriptSegmentText({
        transcriptId,
        wordIds,
        text: spaceEditedText(wordTexts, nextText).text,
      }).catch((error) => {
        console.error("[transcript] failed to update text", error);
      });
    },
    [originalText, speakerChange, transcriptId, wordIds, wordTexts],
  );
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
        return;

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
      const selection = window.getSelection();
      if (!selection?.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!event.currentTarget.contains(range.startContainer)) return;
      const before = range.cloneRange();
      before.selectNodeContents(event.currentTarget);
      before.setEnd(range.startContainer, range.startOffset);
      const text = event.currentTarget.textContent ?? "";
      const offset = before.toString().length;
      event.preventDefault();
      if (text.slice(offset).trim()) setSpeakerChange({ text, offset });
    },
    [],
  );

  return (
    <Popover
      open={speakerChange !== null}
      onOpenChange={(open) => {
        if (!open) setSpeakerChange(null);
      }}
    >
      <div
        ref={editorRef}
        hidden={speakerChange !== null}
        data-transcript-segment-content
        data-transcript-editor
        data-transcript-edit-word-ids={JSON.stringify(wordIds)}
        data-transcript-edit-word-start-ms={JSON.stringify(
          segment.words.map((word) => word.start_ms),
        )}
        data-transcript-edit-word-texts={JSON.stringify(wordTexts)}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className={cn([
          "overflow-wrap-anywhere mt-0.5 rounded-md text-[15px] leading-relaxed wrap-break-word outline-hidden",
          "select-text-deep",
        ])}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      >
        {originalText}
      </div>
      {speakerChange && (
        <div
          data-transcript-split-preview
          className="mt-0.5 text-[15px] leading-relaxed wrap-break-word"
        >
          {speakerChange.text.slice(0, speakerChange.offset).trim()}
          <PopoverAnchor asChild>
            <div data-transcript-speaker-split className="mt-5">
              {speakerChange.text.slice(speakerChange.offset).trim()}
            </div>
          </PopoverAnchor>
        </div>
      )}
      <PopoverContent
        variant="app"
        side="bottom"
        align="start"
        collisionPadding={12}
        className="flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-24px)] flex-col overflow-hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            editorRef.current?.focus({ preventScroll: true }),
          );
        }}
      >
        <SpeakerParticipantPicker
          sessionId={sessionId}
          showAssignmentScope={false}
          onSelect={async (humanId) => {
            if (!speakerChange) return;
            await splitTranscriptSpeaker({
              transcriptId,
              segmentKey: segment.key,
              wordIds,
              ...spaceEditedText(
                wordTexts,
                speakerChange.text,
                speakerChange.offset,
              ),
              humanId,
            });
            setSpeakerChange(null);
          }}
        />
      </PopoverContent>
    </Popover>
  );
});

function normalizeEditableTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function canReuseSegmentForSearch(
  prev: { segment: Segment; search: TranscriptSearchRenderState },
  next: { segment: Segment; search: TranscriptSearchRenderState },
) {
  if (
    prev.search.query !== next.search.query ||
    prev.search.caseSensitive !== next.search.caseSensitive ||
    prev.search.wholeWord !== next.search.wholeWord
  ) {
    return false;
  }

  if (prev.search.activeMatchId === next.search.activeMatchId) {
    return true;
  }

  return (
    !segmentContainsWordId(prev.segment, prev.search.activeMatchId) &&
    !segmentContainsWordId(next.segment, next.search.activeMatchId)
  );
}

function segmentContainsWordId(segment: Segment, wordId: string | null) {
  if (!wordId) {
    return false;
  }

  return segment.words.some((word) => word.id === wordId);
}

export function getWordDisplayText(word: SegmentWord) {
  return word.text.trim();
}
