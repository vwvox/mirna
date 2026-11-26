import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { joinWordTexts, type TranscriptParagraph } from "./utils";

import { useLessonSession, useLessonSheet } from "~/lesson/queries";
import type { LessonChapter, LessonVocabularyItem } from "~/lesson/types";
import { hanVocabularyTerms } from "~/stt/pinyin";

/**
 * What the transcript shows from the note as a whole: the lesson sheet (when
 * the note is a lesson) and what every capture in it said.
 */
export type TranscriptNote = {
  /** Lessons show Chinese with pinyin above until the student picks a display. */
  isLesson: boolean;
  chapters: readonly LessonChapter[];
  vocabulary: ReadonlyMap<string, LessonVocabularyItem>;
  vocabularyTerms: ReadonlySet<string>;
  translations: ReadonlyMap<string, string>;
  /** Chapters at or before this time belong to an earlier capture. */
  chapterFloors: ReadonlyMap<string, number>;
  reportLastRowStart: (transcriptId: string, ms: number | null) => void;
  registerText: (transcriptId: string, getText: () => string) => () => void;
  countInNote: (term: string) => number;
};

const EMPTY_VOCABULARY = new Map<string, LessonVocabularyItem>();
const EMPTY_TERMS = new Set<string>();
const EMPTY_TRANSLATIONS = new Map<string, string>();
const EMPTY_FLOORS = new Map<string, number>();

const EMPTY_NOTE: TranscriptNote = {
  isLesson: false,
  chapters: [],
  vocabulary: EMPTY_VOCABULARY,
  vocabularyTerms: EMPTY_TERMS,
  translations: EMPTY_TRANSLATIONS,
  chapterFloors: EMPTY_FLOORS,
  reportLastRowStart: () => {},
  registerText: () => () => {},
  countInNote: () => 0,
};

const TranscriptNoteContext = createContext<TranscriptNote>(EMPTY_NOTE);

export function useTranscriptNote() {
  return useContext(TranscriptNoteContext);
}

/** Text compared without punctuation or spaces, so a translation finds its sentence. */
export function translationKey(text: string): string {
  return text.normalize("NFKC").replace(/[\p{P}\p{S}\s]/gu, "");
}

export function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  for (
    let index = text.indexOf(term);
    index !== -1;
    index = text.indexOf(term, index + term.length)
  ) {
    count += 1;
  }
  return count;
}

export function TranscriptNoteProvider({
  sessionId,
  transcriptIds,
  children,
}: {
  sessionId?: string;
  transcriptIds: readonly string[];
  children: ReactNode;
}) {
  const sheet = useLessonSheet(sessionId)?.sheet ?? null;
  const isLesson = useLessonSession(sessionId).isLesson;
  const [lastRowStarts, setLastRowStarts] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const textsRef = useRef(new Map<string, () => string>());

  const lesson = useMemo(() => {
    if (!sheet) {
      return {
        chapters: [],
        vocabulary: EMPTY_VOCABULARY,
        vocabularyTerms: EMPTY_TERMS,
        translations: EMPTY_TRANSLATIONS,
      };
    }
    const vocabulary = new Map<string, LessonVocabularyItem>();
    for (const item of sheet.vocabulary) {
      const term = item.term.trim();
      if (term && !vocabulary.has(term)) vocabulary.set(term, item);
    }
    const translations = new Map<string, string>();
    for (const item of sheet.translations) {
      const key = translationKey(item.text);
      if (key && item.translation.trim() && !translations.has(key)) {
        translations.set(key, item.translation.trim());
      }
    }
    return {
      chapters: [...sheet.chapters].sort(
        (left, right) => left.startMs - right.startMs,
      ),
      vocabulary,
      vocabularyTerms: hanVocabularyTerms(vocabulary.keys()),
      translations,
    };
  }, [sheet]);

  // Live capture moves the last capture's end with every new turn; the floors
  // (and so every row reading this context) only change when an earlier one does.
  let floor = Number.NEGATIVE_INFINITY;
  const floorsKey = transcriptIds
    .map((transcriptId) => {
      const entry = `${transcriptId}\t${floor}`;
      floor = Math.max(floor, lastRowStarts.get(transcriptId) ?? floor);
      return entry;
    })
    .join("\n");
  const chapterFloors = useMemo(
    () =>
      new Map(
        floorsKey
          .split("\n")
          .filter(Boolean)
          .map((entry) => {
            const [transcriptId = "", value = ""] = entry.split("\t");
            return [transcriptId, Number(value)] as const;
          }),
      ),
    [floorsKey],
  );

  const reportLastRowStart = useCallback(
    (transcriptId: string, ms: number | null) => {
      setLastRowStarts((current) => {
        if ((current.get(transcriptId) ?? null) === ms) return current;
        const next = new Map(current);
        if (ms === null) next.delete(transcriptId);
        else next.set(transcriptId, ms);
        return next;
      });
    },
    [],
  );
  const registerText = useCallback(
    (transcriptId: string, getText: () => string) => {
      textsRef.current.set(transcriptId, getText);
      return () => {
        if (textsRef.current.get(transcriptId) === getText) {
          textsRef.current.delete(transcriptId);
        }
      };
    },
    [],
  );
  const countInNote = useCallback((term: string) => {
    let count = 0;
    for (const getText of textsRef.current.values()) {
      count += countOccurrences(getText(), term);
    }
    return count;
  }, []);

  const value = useMemo<TranscriptNote>(
    () => ({
      ...lesson,
      isLesson,
      chapterFloors,
      reportLastRowStart,
      registerText,
      countInNote,
    }),
    [
      chapterFloors,
      countInNote,
      isLesson,
      lesson,
      registerText,
      reportLastRowStart,
    ],
  );

  return (
    <TranscriptNoteContext.Provider value={value}>
      {children}
    </TranscriptNoteContext.Provider>
  );
}

/**
 * Each chapter heads the first row that starts at or after it, unless an
 * earlier capture already has such a row.
 */
export function placeChapters(
  chapters: readonly LessonChapter[],
  rowStarts: readonly number[],
  floorMs: number,
): Map<number, LessonChapter[]> {
  const placed = new Map<number, LessonChapter[]>();
  for (const chapter of chapters) {
    if (chapter.startMs <= floorMs) continue;
    const index = rowStarts.findIndex((start) => start >= chapter.startMs);
    if (index < 0) continue;
    placed.set(index, [...(placed.get(index) ?? []), chapter]);
  }
  return placed;
}

/** The sheet's translation of a paragraph, or of the sentences in it. */
export function findParagraphTranslation(
  paragraph: TranscriptParagraph,
  translations: ReadonlyMap<string, string>,
): string | null {
  if (translations.size === 0) return null;
  const lineKeys = paragraph.lines.map((line) =>
    translationKey(
      joinWordTexts(line.words.map((word) => word.text.trim())).text,
    ),
  );
  const whole = translations.get(lineKeys.join(""));
  if (whole) return whole;
  const perLine = lineKeys.flatMap((key) => {
    const translation = translations.get(key);
    return translation ? [translation] : [];
  });
  return perLine.length > 0 ? perLine.join(" ") : null;
}
