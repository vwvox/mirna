import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import {
  createTranscriptSearchIndex,
  getTranscriptSearchIndexMatches,
  type MatchResult,
  registerTranscriptSearchSource,
  type TranscriptSearchSource,
} from "../../search/matching";
import { findPinyinMatches, layoutHanLine } from "./han-layout";
import { findParagraphTranslation } from "./note-context";
import { groupWordsIntoLines, groupWordsIntoParagraphs } from "./utils";

import type { Segment } from "~/stt/live-segment";
import {
  type ChineseDisplayMode,
  getLoadedPinyinModule,
  hasHan,
  type PinyinTools,
  toPinyinQuery,
} from "~/stt/pinyin";

const OVERSCAN_PX = 800;
const FALLBACK_VIEWPORT_HEIGHT = 800;

// Heights of the row parts in segment.tsx, so rows that haven't been
// measured yet take about the room they will need.
const ROW_GAP = 4;
const ROW_CHROME = 38;
const CHIP_ROW = 28;
const CHIP_RUBY_EXTRA = 10;
const CHAPTER_HEIGHT = 56;
const PARAGRAPH_GAP = 8;
const TRANSLATION_GAP = 4;
const TRANSLATION_LINE = 20;
const TRANSLATION_CHAR_PX = 6.4;
const LATIN_CHAR_PX = 7.2;
const TEXT_INSET = 116;
const FALLBACK_TEXT_WIDTH = 600;
const LINE_HEIGHT: Record<ChineseDisplayMode | "latin", number> = {
  latin: 24.4,
  characters: 27,
  "pinyin-above": 37.5,
  "word-by-word": 50,
  "pinyin-only": 24.4,
};
const MEANING_LINE_EXTRA = 12;
// Width a Chinese character takes in each display, pinyin included.
const HAN_CHAR_PX: Record<ChineseDisplayMode, number> = {
  characters: 16.5,
  "pinyin-above": 22,
  "word-by-word": 24,
  "pinyin-only": 25,
};
const HAN_CHARACTER = /\p{Script=Han}/u;

export type TranscriptRowEstimate = {
  variant?: "row" | "chip";
  chapters?: number;
  mode?: ChineseDisplayMode;
  textWidth?: number | null;
  translations?: ReadonlyMap<string, string> | null;
  meanings?: boolean;
};

/** What the list knows about its rows beyond their words. */
export type TranscriptRowLayout = {
  chips: ReadonlySet<number>;
  chapterCounts: ReadonlyMap<number, number>;
  mode: ChineseDisplayMode;
  translations: ReadonlyMap<string, string> | null;
  meanings: boolean;
};

export function estimateTranscriptRowHeight(
  segment: Segment,
  index: number,
  {
    variant = "row",
    chapters = 0,
    mode = "characters",
    textWidth,
    translations,
    meanings = false,
  }: TranscriptRowEstimate = {},
) {
  const above = (index > 0 ? ROW_GAP : 0) + chapters * CHAPTER_HEIGHT;
  if (variant === "chip") {
    const ruby =
      (mode === "pinyin-above" || mode === "word-by-word") &&
      segment.words.some((word) => hasHan(word.text));
    return Math.round(above + CHIP_ROW + (ruby ? CHIP_RUBY_EXTRA : 0));
  }

  const width = Math.max(160, textWidth ?? FALLBACK_TEXT_WIDTH);
  const paragraphs = groupWordsIntoParagraphs(segment.words);
  let height = above + ROW_CHROME;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    let latin = 0;
    let han = 0;
    for (const line of paragraph.lines) {
      for (const word of line.words) {
        const text = word.text.trim();
        if (!hasHan(text)) {
          latin += text.length + 1;
          continue;
        }
        for (const character of text) {
          if (HAN_CHARACTER.test(character)) han += 1;
          else latin += 1;
        }
      }
    }
    const lines = Math.max(
      1,
      Math.ceil((latin * LATIN_CHAR_PX + han * HAN_CHAR_PX[mode]) / width),
    );
    const lineHeight =
      han === 0
        ? LINE_HEIGHT.latin
        : LINE_HEIGHT[mode] +
          (mode === "word-by-word" && meanings ? MEANING_LINE_EXTRA : 0);
    height += (paragraphIndex > 0 ? PARAGRAPH_GAP : 0) + lines * lineHeight;

    const translation =
      han > 0 && translations
        ? findParagraphTranslation(paragraph, translations)
        : null;
    if (translation) {
      height +=
        PARAGRAPH_GAP -
        TRANSLATION_GAP +
        TRANSLATION_LINE *
          Math.max(
            1,
            Math.ceil((translation.length * TRANSLATION_CHAR_PX) / width),
          );
    }
  });
  return Math.round(height);
}

export function useVirtualSegments({
  segments,
  segmentKeys,
  scrollElement,
  activeMatchId,
  searchEnabled,
  currentMs,
  offsetMs,
  layout,
  vocabularyTerms,
}: {
  segments: Segment[];
  segmentKeys: string[];
  scrollElement: HTMLDivElement | null;
  activeMatchId: string | null;
  searchEnabled: boolean;
  currentMs: number;
  offsetMs: number;
  layout?: TranscriptRowLayout;
  vocabularyTerms?: ReadonlySet<string>;
}) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const unregisterSearchRef = useRef<(() => void) | null>(null);
  const searchSourceRef = useRef<TranscriptSearchSource>(() => []);
  const scrollToIndexRef = useRef<
    (index: number, behavior: ScrollBehavior) => void
  >(() => {});
  const keySet = useMemo(() => new Set(segmentKeys), [segmentKeys]);
  const latestKeysRef = useRef(keySet);
  latestKeysRef.current = keySet;
  const pendingHeightsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | null>(null);
  const mountedKeysRef = useRef<ReadonlySet<string>>(new Set());

  // A new display changes the height of rows that aren't on screen, so their
  // old measurements give way to fresh estimates; mounted rows re-measure.
  const measurementKey = `${layout?.mode ?? "characters"}|${layout?.translations ? "translated" : ""}`;
  const [measuredFor, setMeasuredFor] = useState(measurementKey);
  if (measuredFor !== measurementKey) {
    setMeasuredFor(measurementKey);
    setMeasuredHeights((current) => {
      const next = new Map<string, number>();
      for (const [key, height] of current) {
        if (mountedKeysRef.current.has(key)) next.set(key, height);
      }
      return next;
    });
  }

  useMountEffect(() => {
    return () => {
      if (measurementFrameRef.current !== null) {
        cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = null;
      }
      pendingHeightsRef.current.clear();
    };
  });

  const viewport = useVirtualViewport(scrollElement, listElement);
  // Whole steps, so dragging the window edge doesn't re-estimate every row each pixel.
  const textWidth =
    viewport.listWidth > TEXT_INSET
      ? Math.round((viewport.listWidth - TEXT_INSET) / 16) * 16
      : null;
  const estimatedHeights = useMemo(
    () =>
      segments.map((segment, index) =>
        estimateTranscriptRowHeight(segment, index, {
          variant: layout?.chips.has(index) ? "chip" : "row",
          chapters: layout?.chapterCounts.get(index) ?? 0,
          mode: layout?.mode,
          textWidth,
          translations: layout?.translations,
          meanings: layout?.meanings,
        }),
      ),
    [layout, segments, textWidth],
  );
  const offsets = useMemo(() => {
    const values = [0];
    for (const [index, key] of segmentKeys.entries()) {
      values.push(
        values[index] +
          (measuredHeights.get(key) ?? estimatedHeights[index] ?? ROW_CHROME),
      );
    }
    return values;
  }, [estimatedHeights, measuredHeights, segmentKeys]);
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const segmentIndex = useMemo(() => createSegmentIndex(segments), [segments]);

  const activeMatchIndex = activeMatchId
    ? (segmentIndex.wordIndexes.get(activeMatchId) ?? null)
    : null;
  const playbackIndex = useMemo(
    () => findPlaybackSegmentIndex(segmentIndex, currentMs, offsetMs),
    [currentMs, offsetMs, segmentIndex],
  );
  const selectedIndexes = useSelectedSegmentIndexes(listElement);
  const virtualItems = useMemo(() => {
    const visibleTop = viewport.scrollTop - viewport.listTop;
    const visibleBottom = visibleTop + viewport.height;
    const indexes = new Set<number>();

    if (visibleBottom > 0 && visibleTop < totalHeight) {
      const start = findRowIndex(
        offsets,
        Math.max(0, visibleTop - OVERSCAN_PX),
      );
      const end = findRowIndex(
        offsets,
        Math.min(totalHeight, visibleBottom + OVERSCAN_PX),
      );
      for (
        let index = start;
        index <= end && index < segments.length;
        index++
      ) {
        indexes.add(index);
      }
    } else if (!scrollElement && segments.length > 0) {
      const end = findRowIndex(offsets, FALLBACK_VIEWPORT_HEIGHT + OVERSCAN_PX);
      for (let index = 0; index <= end && index < segments.length; index++) {
        indexes.add(index);
      }
    }

    if (activeMatchIndex !== null) indexes.add(activeMatchIndex);
    if (playbackIndex !== null) indexes.add(playbackIndex);
    if (focusedIndex !== null) indexes.add(focusedIndex);
    for (const index of selectedIndexes) indexes.add(index);

    return Array.from(indexes)
      .sort((left, right) => left - right)
      .map((index) => ({
        index,
        key: segmentKeys[index]!,
        top: offsets[index]!,
      }));
  }, [
    activeMatchIndex,
    focusedIndex,
    offsets,
    playbackIndex,
    scrollElement,
    selectedIndexes,
    segmentKeys,
    segments.length,
    totalHeight,
    viewport.height,
    viewport.listTop,
    viewport.scrollTop,
  ]);
  mountedKeysRef.current = new Set(virtualItems.map((item) => item.key));

  const measureRow = useCallback((key: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    pendingHeightsRef.current.set(key, height);
    if (measurementFrameRef.current !== null) return;

    // Resizing reflows many rows together; copy the height cache only once.
    measurementFrameRef.current = requestAnimationFrame(() => {
      measurementFrameRef.current = null;
      const pending = pendingHeightsRef.current;
      pendingHeightsRef.current = new Map();
      setMeasuredHeights((current) => {
        const keys = latestKeysRef.current;
        const changed = Array.from(pending).some(([key, height]) => {
          const previous = current.get(key);
          return (
            keys.has(key) &&
            (previous === undefined || Math.abs(previous - height) >= 1)
          );
        });
        const pruneNeeded = Array.from(current.keys()).some(
          (key) => !keys.has(key),
        );
        if (!changed && !pruneNeeded) return current;

        const next = new Map<string, number>();
        for (const [key, height] of current) {
          if (keys.has(key)) next.set(key, height);
        }
        for (const [key, height] of pending) {
          if (keys.has(key)) next.set(key, height);
        }
        return next;
      });
    });
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      if (
        !scrollElement ||
        !listElement ||
        index < 0 ||
        index >= segments.length
      ) {
        return;
      }
      const scrollRect = scrollElement.getBoundingClientRect();
      const listRect = listElement.getBoundingClientRect();
      const listTop = scrollElement.scrollTop + listRect.top - scrollRect.top;
      const rowHeight = offsets[index + 1]! - offsets[index]!;
      const top =
        listTop +
        offsets[index]! -
        Math.max(0, (scrollElement.clientHeight - rowHeight) / 2);
      scrollElement.scrollTo({ top: Math.max(0, top), behavior });
    },
    [listElement, offsets, scrollElement, segments.length],
  );
  scrollToIndexRef.current = scrollToIndex;

  const previousActiveMatchRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (
      activeMatchId &&
      activeMatchId !== previousActiveMatchRef.current &&
      activeMatchIndex !== null &&
      listElement &&
      scrollElement
    ) {
      scrollToIndex(activeMatchIndex, "smooth");
      previousActiveMatchRef.current = activeMatchId;
    } else if (!activeMatchId) {
      previousActiveMatchRef.current = null;
    }
  }, [
    activeMatchId,
    activeMatchIndex,
    listElement,
    scrollElement,
    scrollToIndex,
  ]);

  const searchIndex = useMemo(
    () =>
      searchEnabled
        ? createTranscriptSearchIndex(
            segments.flatMap((segment, index) =>
              segment.words.map((word) => ({
                id: word.id ?? null,
                text: word.text.trim(),
                scrollIntoView: () => scrollToIndexRef.current(index, "smooth"),
              })),
            ),
          )
        : null,
    [searchEnabled, segments],
  );
  searchSourceRef.current = (preparedQuery, options) => {
    if (!searchIndex) return [];
    const matches = getTranscriptSearchIndexMatches(
      searchIndex,
      preparedQuery,
      options,
    );
    const pinyinQuery = toPinyinQuery(preparedQuery);
    const tools = getLoadedPinyinModule();
    if (!pinyinQuery || !tools) return matches;
    const pinyinMatches = findTranscriptPinyinMatches(
      segments,
      pinyinQuery,
      options.wholeWord,
      tools,
      vocabularyTerms,
      (index) => scrollToIndexRef.current(index, "smooth"),
    );
    if (pinyinMatches.length === 0) return matches;
    const ordinals = new Map(
      searchIndex.entries.map((entry, ordinal) => [entry.element, ordinal]),
    );
    return [
      ...matches.map((match) => ({
        match,
        ordinal: ordinals.get(match.element) ?? 0,
      })),
      ...pinyinMatches,
    ]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(({ match }) => match);
  };

  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      unregisterSearchRef.current?.();
      unregisterSearchRef.current = null;
      setListElement(node);
      if (node && scrollElement) {
        unregisterSearchRef.current = registerTranscriptSearchSource(
          scrollElement,
          (preparedQuery, options) =>
            searchSourceRef.current(preparedQuery, options),
        );
      }
    },
    [scrollElement],
  );

  const handleRowFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);
  const handleRowBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocusedIndex(null);
    }
  }, []);

  return {
    handleRowBlur,
    handleRowFocus,
    listRef,
    measureRow,
    totalHeight,
    virtualItems,
  };
}

function useSelectedSegmentIndexes(listElement: HTMLDivElement | null) {
  const subscribe = useCallback((notify: () => void) => {
    document.addEventListener("selectionchange", notify);
    return () => document.removeEventListener("selectionchange", notify);
  }, []);
  const getSnapshot = useCallback(() => {
    if (!listElement) return "";
    const selection = window.getSelection();
    const indexes = [selection?.anchorNode, selection?.focusNode]
      .flatMap((node) => {
        const element =
          node instanceof Element ? node : (node?.parentElement ?? null);
        const row = element?.closest<HTMLElement>(
          "[data-transcript-virtual-index]",
        );
        if (!row || !listElement.contains(row)) return [];
        const index = Number(row.dataset.transcriptVirtualIndex);
        return Number.isInteger(index) ? [index] : [];
      })
      .sort((left, right) => left - right);
    return Array.from(new Set(indexes)).join(",");
  }, [listElement]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () =>
      snapshot ? snapshot.split(",").map(Number).filter(Number.isInteger) : [],
    [snapshot],
  );
}

export function VirtualSegmentRow({
  rowKey,
  top,
  index,
  onMeasure,
  onFocus,
  onBlur,
  children,
}: {
  rowKey: string;
  top: number;
  index: number;
  onMeasure: (key: string, height: number) => void;
  onFocus: (index: number) => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;

      const measure = () => onMeasure(rowKey, node.offsetHeight);
      measure();
      if (typeof ResizeObserver !== "undefined") {
        observerRef.current = new ResizeObserver((entries) => {
          const height = entries[0]?.borderBoxSize?.[0]?.blockSize;
          if (height === undefined) measure();
          else onMeasure(rowKey, height);
        });
        observerRef.current.observe(node, { box: "border-box" });
      }
    },
    [onMeasure, rowKey],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      left: 0,
      position: "absolute",
      top,
      width: "100%",
    }),
    [top],
  );

  return (
    <div
      ref={rowRef}
      data-transcript-virtual-index={index}
      style={style}
      onFocusCapture={() => onFocus(index)}
      onBlurCapture={onBlur}
    >
      {children}
    </div>
  );
}

function useVirtualViewport(
  scrollElement: HTMLDivElement | null,
  listElement: HTMLDivElement | null,
) {
  const store = useMemo(
    () => createVirtualViewportStore(scrollElement, listElement),
    [listElement, scrollElement],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [scrollTop, height, listTop, listWidth] = snapshot
    .split("|")
    .map(Number);
  return { scrollTop, height, listTop, listWidth };
}

function createVirtualViewportStore(
  scrollElement: HTMLDivElement | null,
  listElement: HTMLDivElement | null,
) {
  let listTop: number | null = null;
  let listWidth = 0;
  let snapshot = `0|${FALLBACK_VIEWPORT_HEIGHT}|0|0`;
  let animationFrame: number | null = null;
  let shouldMeasureList = true;
  const listeners = new Set<() => void>();

  const refresh = (measureList: boolean) => {
    if (!scrollElement) {
      snapshot = `0|${FALLBACK_VIEWPORT_HEIGHT}|0|0`;
      return;
    }

    if (measureList || listTop === null) {
      const scrollRect = scrollElement.getBoundingClientRect();
      const listRect = listElement?.getBoundingClientRect();
      listTop = listRect
        ? scrollElement.scrollTop + listRect.top - scrollRect.top
        : scrollElement.scrollTop;
      listWidth = listRect?.width || scrollElement.clientWidth || 0;
    }
    const next = `${scrollElement.scrollTop}|${scrollElement.clientHeight || FALLBACK_VIEWPORT_HEIGHT}|${listTop}|${listWidth}`;
    if (next !== snapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  };

  const scheduleRefresh = (measureList = false) => {
    shouldMeasureList ||= measureList;
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      const measure = shouldMeasureList;
      shouldMeasureList = false;
      refresh(measure);
    });
  };

  refresh(true);
  const subscribe = (listener: () => void) => {
    if (!scrollElement) return () => {};
    listeners.add(listener);
    const handleScroll = () => scheduleRefresh();
    const handleLayout = () => scheduleRefresh(true);
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleLayout);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleLayout);
    resizeObserver?.observe(scrollElement);
    if (listElement) resizeObserver?.observe(listElement);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(handleLayout);
    mutationObserver?.observe(scrollElement, {
      childList: true,
      subtree: true,
    });
    scheduleRefresh(true);

    return () => {
      listeners.delete(listener);
      scrollElement.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleLayout);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };
  };

  return { getSnapshot: () => snapshot, subscribe };
}

function findRowIndex(offsets: number[], target: number): number {
  if (offsets.length <= 1) return 0;
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1]! <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function createSegmentIndex(segments: Segment[]) {
  const wordIndexes = new Map<string, number>();
  const playbackStarts: number[] = [];
  const playbackEnds: number[] = [];
  const playbackSegmentIndexes: number[] = [];
  const playbackPrefixMaxEnds: number[] = [];

  segments.forEach((segment, segmentIndex) => {
    for (const word of segment.words) {
      if (word.id && !wordIndexes.has(word.id)) {
        wordIndexes.set(word.id, segmentIndex);
      }
    }
    const first = segment.words[0];
    const last = segment.words[segment.words.length - 1];
    if (!first || !last) return;
    const start = first.start_ms ?? 0;
    const end = last.end_ms ?? 0;
    playbackStarts.push(start);
    playbackEnds.push(end);
    playbackSegmentIndexes.push(segmentIndex);
    playbackPrefixMaxEnds.push(
      Math.max(
        playbackPrefixMaxEnds[playbackPrefixMaxEnds.length - 1] ??
          Number.NEGATIVE_INFINITY,
        end,
      ),
    );
  });

  return {
    wordIndexes,
    playbackStarts,
    playbackEnds,
    playbackSegmentIndexes,
    playbackPrefixMaxEnds,
  };
}

function findPlaybackSegmentIndex(
  index: ReturnType<typeof createSegmentIndex>,
  currentMs: number,
  offsetMs: number,
): number | null {
  if (currentMs <= 0) return null;
  const target = currentMs - offsetMs;
  let low = 0;
  let high = index.playbackStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.playbackStarts[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  const lastStarted = low - 1;
  if (lastStarted < 0) return null;

  low = 0;
  high = lastStarted;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.playbackPrefixMaxEnds[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return index.playbackEnds[low]! >= target
    ? index.playbackSegmentIndexes[low]!
    : null;
}

/** Chinese words whose pinyin, typed without tones, matches the query ("dou" finds 都). */
function findTranscriptPinyinMatches(
  segments: Segment[],
  query: string,
  wholeWord: boolean,
  tools: PinyinTools,
  terms: ReadonlySet<string> | undefined,
  scrollToSegment: (index: number) => void,
): { match: MatchResult; ordinal: number }[] {
  const results: { match: MatchResult; ordinal: number }[] = [];
  let ordinal = 0;
  segments.forEach((segment, segmentIndex) => {
    const segmentOrdinal = ordinal;
    ordinal += segment.words.length;
    if (!segment.words.some((word) => hasHan(word.text))) return;
    let lineOrdinal = segmentOrdinal;
    const element = {
      scrollIntoView: () => scrollToSegment(segmentIndex),
    } as HTMLElement;
    for (const line of groupWordsIntoLines(segment.words)) {
      const hanLine = layoutHanLine(
        line.words.map((word) => word.text.trim()),
        tools,
        terms,
      );
      if (hanLine) {
        for (const wordIndexes of findPinyinMatches(
          hanLine,
          query,
          wholeWord,
        )) {
          const first = wordIndexes[0]!;
          results.push({
            match: { element, id: line.words[first]?.id ?? null },
            ordinal: lineOrdinal + first,
          });
        }
      }
      lineOrdinal += line.words.length;
    }
  });
  return results;
}
