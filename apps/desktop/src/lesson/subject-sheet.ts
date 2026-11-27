import { z } from "zod";

import { parseClock } from "./time";
import type {
  LessonMarksDocument,
  LessonSheet,
  LessonSubject,
  LessonTalkStats,
  SubjectSection,
} from "./types";
import { SOURCE_KINDS } from "./types";

const clock = z
  .string()
  .default("")
  .describe('Time in the recording as "mm:ss" or "h:mm:ss", or "" if unsure');

const step = z.object({
  text: z.string().describe("One step; maths goes between $ signs as LaTeX"),
  at: clock,
});

/** What the AI writes for a topic or a maths class. Every part may be empty. */
export const aiSubjectSheetSchema = z.object({
  topic: z
    .string()
    .default("")
    .describe("2 to 6 words naming what the class covered, for its title"),
  summary: z
    .string()
    .default("")
    .describe("One sentence on what the class was about"),
  chapters: z
    .array(z.object({ title: z.string(), start: clock }))
    .default([])
    .describe("3 to 8 parts of the class in order, short titles"),
  keyTerms: z
    .array(
      z.object({
        term: z.string(),
        definition: z
          .string()
          .default("")
          .describe("What it means, in the teacher's own words where possible"),
        heardAt: clock.describe("When the teacher explains it"),
      }),
    )
    .default([]),
  ideas: z
    .array(
      z.object({
        title: z.string().describe("The idea as one short sentence"),
        explanation: z.string().default(""),
        example: z
          .string()
          .default("")
          .describe("The example the teacher used for it, or empty"),
        exampleAt: clock,
        terms: z
          .array(z.string())
          .default([])
          .describe("Key terms from keyTerms that the idea uses"),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        name: z
          .string()
          .describe("A person, book, case, law or study the class cited"),
        kind: z.enum(SOURCE_KINDS).catch("other").default("other"),
        year: z.string().default("").describe('As said: "1893", or ""'),
        note: z.string().default("").describe("Why it came up, one sentence"),
        at: clock,
      }),
    )
    .default([]),
  methods: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            "A method, procedure or recipe the class walked through step by step",
          ),
        at: clock,
        steps: z.array(step).default([]),
      }),
    )
    .default([]),
  checkYourself: z
    .array(
      z.object({
        question: z.string(),
        answer: z
          .string()
          .default("")
          .describe("The answer, as the class gave it"),
        at: clock.describe("Where the class explains the answer"),
      }),
    )
    .default([]),
  formulas: z
    .array(
      z.object({
        name: z.string().describe("What the formula is called"),
        latex: z.string().describe("The formula in LaTeX, without $ signs"),
        symbols: z
          .array(z.object({ symbol: z.string(), meaning: z.string() }))
          .default([])
          .describe("Each symbol as LaTeX, and what it stands for"),
        whenToUse: z.string().default(""),
        at: clock,
        from: z
          .enum(["speech", "notes"])
          .catch("speech")
          .default("speech")
          .describe(
            '"notes" when the student wrote it in their notes, "speech" when rebuilt from what was said',
          ),
      }),
    )
    .default([]),
  workedExamples: z
    .array(
      z.object({
        problem: z.string(),
        at: clock,
        steps: z.array(step).default([]),
        answer: z.string().default(""),
      }),
    )
    .default([]),
  slips: z
    .array(
      z.object({
        said: z.string().describe("What was said or written wrongly"),
        corrected: z.string().describe("The right version"),
        why: z.string().default(""),
        at: clock,
      }),
    )
    .default([]),
  problems: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string().default(""),
        steps: z
          .array(z.string())
          .default([])
          .describe("The steps to the answer, to show one at a time"),
        at: clock,
      }),
    )
    .default([]),
  homework: z
    .array(
      z.object({
        text: z.string(),
        due: z.string().default(""),
        at: clock,
      }),
    )
    .default([]),
  markAnswers: z
    .array(z.object({ markId: z.string(), answer: z.string() }))
    .default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type AiSubjectSheet = z.infer<typeof aiSubjectSheetSchema>;

const SECTION_NAMES: Record<SubjectSection, string> = {
  keyTerms: "keyTerms",
  ideas: "ideas",
  sources: "sources",
  methods: "methods",
  checkYourself: "checkYourself",
  formulas: "formulas",
  workedExamples: "workedExamples",
  slips: "slips",
  problems: "problems",
};

const SUBJECT_PROMPT = `You write study sheets for a student who records their classes. This class is SUBJECT_LINE.
The transcript comes from speech recognition, so expect misheard words; prefer what the context makes likely and leave out what you can't make sense of.
Lines are "[time] Speaker: text". "Teacher" is the teacher, "Student" is the student.
Write everything in CLASS_LANGUAGE. Only include what actually happened in this class: every part may be empty, and an empty part is better than an invented one.
- topic: what the class covered in a few words.
- keyTerms: the terms the class defined or relied on, at most 30, most important first, each defined as the teacher put it. Not things that only came up in passing.
- ideas: the main ideas or arguments, at most 6, each with the example the teacher used. Leave out jokes, asides and small talk: three real ideas beat six thin ones.
- sources: people, books, cases, laws and studies the class cited, with why each came up. Give names in full when the class did.
- methods: only when the class walked through a method, a procedure or a recipe step by step. Keep quantities, temperatures and times exactly as said.
- checkYourself: 3 to 6 questions a student could test themselves with, each answered from the class.
- formulas: every formula used, in LaTeX, with what each symbol means and when to use it. Formulas are mostly written, not said, so rebuild them carefully from what was said. When the student's notes have a formula between $ signs, use theirs and set from to "notes".
- workedExamples: problems solved in class, with each step as done in class. Put maths between $ signs.
- slips: mistakes people made in class, by the student or others, with the right version. Not misheard words in this transcript.
- problems: problems set in class for practice, with their steps and answer if the class gave them.
- homework: only tasks the teacher actually set.
- markAnswers: one entry for every mark id given, saying what happened around that moment.EMPHASIS`;

const MATHS_EMPHASIS = `
This is a maths or science class: formulas and worked examples matter most. Keep every formula and every step exact.`;

const OUTPUT_INSTRUCTIONS = `Reply with one JSON object and nothing else, matching this JSON schema:
${JSON.stringify(z.toJSONSchema(aiSubjectSheetSchema))}`;

export function subjectSheetSystemPrompt({
  subject,
  subjectName,
  classLanguage,
  leaveOut = [],
}: {
  subject: Exclude<LessonSubject, "language">;
  subjectName: string;
  classLanguage: string;
  leaveOut?: readonly SubjectSection[];
}): string {
  const name = subjectName.trim();
  const line = name
    ? `about ${name}`
    : subject === "maths"
      ? "a maths or science class"
      : "a class on a topic";
  const skip = leaveOut.length
    ? `\nLeave these parts empty, the student doesn't want them: ${leaveOut.map((section) => SECTION_NAMES[section]).join(", ")}.`
    : "";
  const instructions = SUBJECT_PROMPT.replace("SUBJECT_LINE", line)
    .replace("CLASS_LANGUAGE", classLanguage)
    .replace("EMPHASIS", (subject === "maths" ? MATHS_EMPHASIS : "") + skip);
  return `${instructions}\n\n${OUTPUT_INSTRUCTIONS}`;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** Strips $ signs the model sometimes wraps a whole formula in. */
export function bareLatex(latex: string): string {
  return latex
    .trim()
    .replace(/^\${1,2}|\${1,2}$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .trim();
}

export function toSubjectSheet(
  ai: AiSubjectSheet,
  {
    knownTerms,
    talk,
    marks,
  }: {
    knownTerms: Set<string>;
    talk: LessonTalkStats | null;
    marks: LessonMarksDocument;
  },
): LessonSheet {
  const markIds = new Set(marks.marks.map((mark) => mark.id));
  const steps = (items: { text: string; at: string }[]) =>
    items
      .filter((item) => item.text.trim())
      .map((item) => ({ text: item.text.trim(), atMs: parseClock(item.at) }));
  return {
    version: 1,
    kind: "subject",
    topic: ai.topic.trim().slice(0, 80),
    summary: ai.summary.trim(),
    chapters: ai.chapters
      .map((chapter) => ({
        title: chapter.title.trim(),
        startMs: parseClock(chapter.start),
      }))
      .filter(
        (chapter): chapter is { title: string; startMs: number } =>
          chapter.title.length > 0 && chapter.startMs !== null,
      )
      .sort((a, b) => a.startMs - b.startMs),
    vocabulary: [],
    patterns: [],
    translations: [],
    keyTerms: uniqueBy(
      ai.keyTerms.map((item) => ({
        term: item.term.trim(),
        definition: item.definition.trim(),
        heardAtMs: parseClock(item.heardAt),
        isNew: !knownTerms.has(item.term.trim()),
      })),
      (item) => item.term,
    ),
    ideas: ai.ideas
      .filter((idea) => idea.title.trim())
      .map((idea) => ({
        title: idea.title.trim(),
        explanation: idea.explanation.trim(),
        example: idea.example.trim(),
        exampleAtMs: parseClock(idea.exampleAt),
        terms: idea.terms.map((term) => term.trim()).filter(Boolean),
      })),
    sources: uniqueBy(
      ai.sources.map((source) => ({
        name: source.name.trim(),
        kind: source.kind,
        year: source.year.trim(),
        note: source.note.trim(),
        atMs: parseClock(source.at),
      })),
      (source) => source.name,
    ),
    methods: ai.methods
      .filter((method) => method.title.trim() && method.steps.length > 0)
      .map((method) => ({
        title: method.title.trim(),
        atMs: parseClock(method.at),
        steps: steps(method.steps),
      })),
    checkYourself: ai.checkYourself
      .filter((item) => item.question.trim())
      .map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
        atMs: parseClock(item.at),
      })),
    formulas: uniqueBy(
      ai.formulas
        .filter((formula) => bareLatex(formula.latex))
        .map((formula) => ({
          name: formula.name.trim(),
          latex: bareLatex(formula.latex),
          symbols: formula.symbols
            .filter((item) => item.symbol.trim())
            .map((item) => ({
              symbol: bareLatex(item.symbol),
              meaning: item.meaning.trim(),
            })),
          whenToUse: formula.whenToUse.trim(),
          atMs: parseClock(formula.at),
          from: formula.from,
        })),
      (formula) => formula.name,
    ),
    workedExamples: ai.workedExamples
      .filter((example) => example.problem.trim())
      .map((example) => ({
        problem: example.problem.trim(),
        atMs: parseClock(example.at),
        steps: steps(example.steps),
        answer: example.answer.trim(),
      })),
    corrections: ai.slips
      .filter((slip) => slip.said.trim() && slip.corrected.trim())
      .map((slip) => ({
        said: slip.said.trim(),
        corrected: slip.corrected.trim(),
        why: slip.why.trim(),
        atMs: parseClock(slip.at),
      })),
    problems: ai.problems
      .filter((problem) => problem.question.trim())
      .map((problem) => ({
        question: problem.question.trim(),
        answer: problem.answer.trim(),
        steps: problem.steps.map((item) => item.trim()).filter(Boolean),
        atMs: parseClock(problem.at),
      })),
    homework: ai.homework
      .filter((item) => item.text.trim())
      .map((item) => ({
        text: item.text.trim(),
        due: item.due.trim(),
        atMs: parseClock(item.at),
      })),
    markAnswers: ai.markAnswers.filter(
      (answer) => markIds.has(answer.markId) && answer.answer.trim(),
    ),
    openQuestions: ai.openQuestions
      .map((question) => question.trim())
      .filter(Boolean),
    talk,
  };
}

/** "Cases and laws" when every source is one, otherwise "People and sources". */
export function sourcesHeading(
  sources: readonly { kind: string }[],
): "cases" | "people" {
  return sources.length > 0 &&
    sources.every((source) => source.kind === "case" || source.kind === "law")
    ? "cases"
    : "people";
}

/** Empty subject parts, for language sheets. */
export const NO_SUBJECT_PARTS = {
  keyTerms: [],
  ideas: [],
  sources: [],
  methods: [],
  checkYourself: [],
  formulas: [],
  workedExamples: [],
  problems: [],
} satisfies Partial<LessonSheet>;
