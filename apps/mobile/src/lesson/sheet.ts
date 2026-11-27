// The study sheet as the Mac sends it: the Mac's own sheet document
// (apps/desktop/src/lesson/types.ts, LessonSheetDocument) plus the teacher
// clips its items play. The phone only shows it; keep the two in step.
import type { ReviewClip } from "./review-plan.ts";

export type SheetVocabularyItem = {
  term: string;
  reading: string;
  meaning: string;
  note: string;
  heardAtMs: number | null;
  isNew: boolean;
};

export type SheetExample = {
  text: string;
  translation: string;
  atMs: number | null;
};

export type SheetPattern = {
  pattern: string;
  explanation: string;
  examples: SheetExample[];
};

export type SheetCorrection = {
  said: string;
  corrected: string;
  why: string;
  atMs: number | null;
};

export type SheetStep = { text: string; atMs: number | null };

export type LessonSheet = {
  version: 1;
  kind: "language" | "subject";
  topic: string;
  summary: string;
  chapters: { title: string; startMs: number }[];
  vocabulary: SheetVocabularyItem[];
  patterns: SheetPattern[];
  corrections: SheetCorrection[];
  homework: { text: string; due: string; atMs: number | null }[];
  openQuestions: string[];
  keyTerms: {
    term: string;
    definition: string;
    heardAtMs: number | null;
    isNew: boolean;
  }[];
  ideas: {
    title: string;
    explanation: string;
    example: string;
    exampleAtMs: number | null;
    terms: string[];
  }[];
  sources: {
    name: string;
    kind: string;
    year: string;
    note: string;
    atMs: number | null;
  }[];
  methods: { title: string; atMs: number | null; steps: SheetStep[] }[];
  checkYourself: { question: string; answer: string; atMs: number | null }[];
  formulas: {
    name: string;
    latex: string;
    symbols: { symbol: string; meaning: string }[];
    whenToUse: string;
    atMs: number | null;
    from: "speech" | "notes";
  }[];
  workedExamples: {
    problem: string;
    atMs: number | null;
    steps: SheetStep[];
    answer: string;
  }[];
  problems: {
    question: string;
    answer: string;
    steps: string[];
    atMs: number | null;
  }[];
};

export type PhoneSheetDocument = {
  sheet: LessonSheet;
  generatedAt: string;
  model: string;
  /**
   * Teacher clips by item: `word:<term>`, `example:<text>`, `slip:<said>`,
   * `term:<term>`.
   */
  clips: Record<string, ReviewClip>;
};

const LISTS = [
  "chapters",
  "vocabulary",
  "patterns",
  "corrections",
  "homework",
  "openQuestions",
  "keyTerms",
  "ideas",
  "sources",
  "methods",
  "checkYourself",
  "formulas",
  "workedExamples",
  "problems",
] as const;

/** The Mac's sheet, with every list there (older Macs leave some out). */
export function parseSheetDocument(
  json: string | null | undefined,
): PhoneSheetDocument | null {
  if (!json) return null;
  try {
    const document = JSON.parse(json) as Partial<PhoneSheetDocument>;
    const sheet = document.sheet as Partial<LessonSheet> | undefined;
    if (!sheet || typeof sheet !== "object") return null;
    const lists = Object.fromEntries(
      LISTS.map((key) => [key, Array.isArray(sheet[key]) ? sheet[key] : []]),
    );
    return {
      sheet: {
        ...sheet,
        ...lists,
        version: 1,
        kind: sheet.kind === "subject" ? "subject" : "language",
        topic: typeof sheet.topic === "string" ? sheet.topic : "",
        summary: typeof sheet.summary === "string" ? sheet.summary : "",
      } as LessonSheet,
      generatedAt: String(document.generatedAt ?? ""),
      model: String(document.model ?? ""),
      clips:
        document.clips && typeof document.clips === "object"
          ? document.clips
          : {},
    };
  } catch {
    return null;
  }
}
