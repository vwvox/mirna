import { Plural, Trans } from "@lingui/react/macro";
import { useMemo, useRef } from "react";

import { Play } from "@anlg/ui/components/icons";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@anlg/ui/components/ui/popover";

import { HAN_STYLE, HanCharacters, PinyinSyllables } from "./han-text";
import { useTranscriptNote } from "./note-context";

import type { SegmentWord } from "~/stt/live-segment";
import type { HanSyllable } from "~/stt/pinyin";

export type WordCardTarget = {
  term: string;
  syllables: readonly HanSyllable[];
  /** The transcript word this occurrence starts in, for playing it. */
  word: SegmentWord | null;
  anchor: HTMLElement;
};

/** A small card for a Chinese word in word-by-word mode: reading, meaning and how often the note says it. */
export function WordCardPopover({
  target,
  toneColours,
  canPlay,
  onPlay,
  onClose,
}: {
  target: WordCardTarget | null;
  toneColours: boolean;
  canPlay: boolean;
  onPlay: (word: SegmentWord) => void;
  onClose: () => void;
}) {
  const elementRef = useRef<HTMLElement | null>(null);
  elementRef.current = target?.anchor ?? null;
  const anchorRef = useRef({
    getBoundingClientRect: () =>
      elementRef.current?.getBoundingClientRect() ?? new DOMRect(),
  });

  return (
    <Popover
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        variant="app"
        side="bottom"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        className="w-60 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {target ? (
          <WordCard
            target={target}
            toneColours={toneColours}
            canPlay={canPlay}
            onPlay={onPlay}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function WordCard({
  target,
  toneColours,
  canPlay,
  onPlay,
}: {
  target: WordCardTarget;
  toneColours: boolean;
  canPlay: boolean;
  onPlay: (word: SegmentWord) => void;
}) {
  const { vocabulary, countInNote } = useTranscriptNote();
  const meaning = vocabulary.get(target.term)?.meaning.trim() ?? "";
  const heard = useMemo(
    () => countInNote(target.term),
    [countInNote, target.term],
  );
  const word = target.word;

  return (
    <div data-transcript-word-card className="flex flex-col gap-1.5">
      <p lang="zh-Hans" style={HAN_STYLE} className="text-2xl leading-tight">
        <HanCharacters
          text={target.term}
          syllables={target.syllables}
          toneColours={toneColours}
        />
      </p>
      <p className="text-sm">
        <PinyinSyllables
          syllables={target.syllables}
          toneColours={toneColours}
        />
      </p>
      {meaning ? <p className="text-foreground text-sm">{meaning}</p> : null}
      <p
        data-transcript-heard-count={heard}
        className="text-muted-foreground text-xs"
      >
        <Plural
          value={heard}
          one="Heard # time in this note"
          other="Heard # times in this note"
        />
      </p>
      {canPlay && word ? (
        <button
          type="button"
          onClick={() => onPlay(word)}
          className="hover:bg-accent mt-1 inline-flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-xs font-medium"
        >
          <Play aria-hidden className="size-3" />
          <Trans>Play</Trans>
        </button>
      ) : null}
    </div>
  );
}
