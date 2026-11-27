import { z } from "zod";

import {
  LESSON_SUBJECTS,
  type LessonFixesDocument,
  type LessonMarksDocument,
  type LessonPracticeDocument,
  type LessonSettings,
  type LessonSheetDocument,
  type LessonSubject,
  SOURCE_KINDS,
  SUBJECT_SECTIONS,
} from "./types";

const markSchema = z.object({
  id: z.string(),
  kind: z.enum(["important", "confused", "homework"]),
  atMs: z.number(),
  note: z.string().catch(""),
  createdAt: z.string().catch(""),
});

const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  atMs: z.number().nullable().catch(null),
  asked: z.boolean().catch(false),
  createdAt: z.string().catch(""),
});

const marksDocumentSchema = z.object({
  version: z.literal(1).catch(1),
  marks: z.array(markSchema).catch([]),
  questions: z.array(questionSchema).catch([]),
});

export function parseLessonMarks(raw: unknown): LessonMarksDocument | null {
  const parsed = marksDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function emptyLessonMarks(): LessonMarksDocument {
  return { version: 1, marks: [], questions: [] };
}

const msSchema = z.number().nullable().catch(null);
const text = z.string().catch("");

const stepSchema = z.object({ text: z.string(), atMs: msSchema });

export const lessonSheetSchema = z.object({
  version: z.literal(1).catch(1),
  kind: z.enum(["language", "subject"]).catch("language"),
  topic: text,
  summary: text,
  chapters: z
    .array(z.object({ title: z.string(), startMs: z.number() }))
    .catch([]),
  vocabulary: z
    .array(
      z.object({
        term: z.string(),
        reading: text,
        meaning: text,
        note: text,
        heardAtMs: msSchema,
        isNew: z.boolean().catch(true),
      }),
    )
    .catch([]),
  keyTerms: z
    .array(
      z.object({
        term: z.string(),
        definition: text,
        heardAtMs: msSchema,
        isNew: z.boolean().catch(true),
      }),
    )
    .catch([]),
  ideas: z
    .array(
      z.object({
        title: z.string(),
        explanation: text,
        example: text,
        exampleAtMs: msSchema,
        terms: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  sources: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(SOURCE_KINDS).catch("other"),
        year: text,
        note: text,
        atMs: msSchema,
      }),
    )
    .catch([]),
  methods: z
    .array(
      z.object({
        title: z.string(),
        atMs: msSchema,
        steps: z.array(stepSchema).catch([]),
      }),
    )
    .catch([]),
  checkYourself: z
    .array(z.object({ question: z.string(), answer: text, atMs: msSchema }))
    .catch([]),
  formulas: z
    .array(
      z.object({
        name: z.string(),
        latex: z.string(),
        symbols: z
          .array(z.object({ symbol: z.string(), meaning: text }))
          .catch([]),
        whenToUse: text,
        atMs: msSchema,
        from: z.enum(["speech", "notes"]).catch("speech"),
      }),
    )
    .catch([]),
  workedExamples: z
    .array(
      z.object({
        problem: z.string(),
        atMs: msSchema,
        steps: z.array(stepSchema).catch([]),
        answer: text,
      }),
    )
    .catch([]),
  problems: z
    .array(
      z.object({
        question: z.string(),
        answer: text,
        steps: z.array(z.string()).catch([]),
        atMs: msSchema,
      }),
    )
    .catch([]),
  patterns: z
    .array(
      z.object({
        pattern: z.string(),
        explanation: text,
        examples: z
          .array(
            z.object({
              text: z.string(),
              translation: text,
              atMs: msSchema,
            }),
          )
          .catch([]),
      }),
    )
    .catch([]),
  corrections: z
    .array(
      z.object({
        said: z.string(),
        corrected: z.string(),
        why: text,
        atMs: msSchema,
      }),
    )
    .catch([]),
  homework: z
    .array(z.object({ text: z.string(), due: text, atMs: msSchema }))
    .catch([]),
  markAnswers: z
    .array(z.object({ markId: z.string(), answer: z.string() }))
    .catch([]),
  openQuestions: z.array(z.string()).catch([]),
  translations: z
    .array(z.object({ text: z.string(), translation: z.string() }))
    .catch([]),
  talk: z
    .object({ studentMs: z.number(), teacherMs: z.number() })
    .nullable()
    .catch(null),
});

const sheetDocumentSchema = z.object({
  sheet: lessonSheetSchema,
  generatedAt: text,
  model: text,
  sourceHash: text,
});

export function parseLessonSheetDocument(
  raw: unknown,
): LessonSheetDocument | null {
  const parsed = sheetDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const cardStateSchema = z.object({
  due: z.string(),
  intervalDays: z.number(),
  ease: z.number(),
  reps: z.number(),
  lapses: z.number(),
  lastReviewedAt: z.string(),
});

const practiceDocumentSchema = z.object({
  version: z.literal(1).catch(1),
  cards: z.record(z.string(), cardStateSchema).catch({}),
  skipped: z.array(z.string()).optional().catch(undefined),
  toneChecks: z
    .array(z.object({ tone: z.number(), ok: z.boolean(), at: z.string() }))
    .optional()
    .catch(undefined),
  reviews: z
    .array(
      z.object({
        id: z.string(),
        startedAt: z.string(),
        endedAt: z.string(),
        length: z.union([z.literal(5), z.literal(10)]),
        device: z.enum(["mac", "phone"]),
        right: z.number(),
        total: z.number(),
        results: z
          .array(
            z.object({
              pieceId: z.string(),
              kind: z.string(),
              outcome: z.enum(["missed", "shaky", "knew"]),
            }),
          )
          .catch([]),
      }),
    )
    .optional()
    .catch(undefined),
});

export function parseLessonPractice(
  raw: unknown,
): LessonPracticeDocument | null {
  const parsed = practiceDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function emptyLessonPractice(): LessonPracticeDocument {
  return { version: 1, cards: {} };
}

const settingsSchema = z.object({
  learning: z.string().min(1),
  explainIn: z.string().min(1),
  subject: z.enum(LESSON_SUBJECTS).optional().catch(undefined),
  subjectName: z.string().optional().catch(undefined),
  leaveOut: z.array(z.enum(SUBJECT_SECTIONS)).optional().catch(undefined),
});

export function parseLessonSettings(raw: unknown): LessonSettings | null {
  const parsed = settingsSchema.safeParse(
    typeof raw === "string" ? safeJson(raw) : raw,
  );
  if (!parsed.success) return null;
  const { subject, subjectName, leaveOut, ...rest } = parsed.data;
  return {
    ...rest,
    ...(subject ? { subject } : {}),
    ...(subjectName ? { subjectName } : {}),
    ...(leaveOut?.length ? { leaveOut } : {}),
  };
}

/** A lesson's kind of class; lessons from before subjects are language lessons. */
export function lessonSubject(
  settings: LessonSettings | null | undefined,
): LessonSubject {
  return settings?.subject ?? "language";
}

const fixesSchema = z.object({
  version: z.literal(1).catch(1),
  formulas: z
    .record(z.string(), z.object({ latex: z.string(), at: text }))
    .catch({}),
});

export function parseLessonFixes(raw: unknown): LessonFixesDocument | null {
  const parsed = fixesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function emptyLessonFixes(): LessonFixesDocument {
  return { version: 1, formulas: {} };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
