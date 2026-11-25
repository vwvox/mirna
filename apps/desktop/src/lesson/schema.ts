import { z } from "zod";

import type {
  LessonMarksDocument,
  LessonPracticeDocument,
  LessonSettings,
  LessonSheetDocument,
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

export const lessonSheetSchema = z.object({
  version: z.literal(1).catch(1),
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
        heardAtMs: msSchema,
        isNew: z.boolean().catch(true),
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
});

export function parseLessonSettings(raw: unknown): LessonSettings | null {
  const parsed = settingsSchema.safeParse(
    typeof raw === "string" ? safeJson(raw) : raw,
  );
  return parsed.success ? parsed.data : null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
