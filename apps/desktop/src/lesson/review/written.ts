import { t } from "@lingui/core/macro";
import { type LanguageModel, Output, streamText } from "ai";
import { z } from "zod";

import { sheetMaxOutputTokens } from "../generate";
import { formatClock, parseClock } from "../time";
import type { LessonSheet, LessonSubject } from "../types";
import { answerMatches, evaluateExpression, formatAnswer } from "./arith";
import type { ReviewClipSource } from "./clip-source";
import { clipOf, type ReviewDraft, seededOrder } from "./drafts";
import { inlineMathToText, latexToText } from "./latex-text";
import type { ReviewFace } from "./types";

/**
 * The pieces only an AI can write: a new case to apply an idea to, a
 * situation that tells two look-alikes apart, groups to sort into, new numbers
 * for a problem, a worked answer with one line made wrong. It only ever writes
 * from the lesson's own sheet, says where from, and never does the sums.
 */
export const REVIEW_PROMPT_VERSION = "review-plan-v2";

const WRITTEN_KINDS = [
  "contrast",
  "apply_it",
  "sort_it",
  "which_formula",
  "twin_problem",
  "spot_slip",
] as const;
type WrittenKind = (typeof WRITTEN_KINDS)[number];

const KINDS_FOR: Record<LessonSubject, WrittenKind[]> = {
  language: ["contrast", "sort_it"],
  topic: ["apply_it", "contrast", "sort_it"],
  maths: ["which_formula", "twin_problem", "spot_slip"],
};

const MAX_PIECES: Record<LessonSubject, number> = {
  language: 3,
  topic: 4,
  maths: 4,
};

const clock = z
  .string()
  .default("")
  .describe('When the teacher explains the point, "mm:ss", or ""');

const writtenPieceSchema = z.object({
  piece: z.enum(WRITTEN_KINDS),
  from: z
    .array(z.string())
    .default([])
    .describe("Ids of the class items this piece is built from"),
  ask: z.string().default("").describe("The question, one short line"),
  situation: z
    .string()
    .default("")
    .describe(
      "contrast, apply_it, which_formula, twin_problem: the case or problem",
    ),
  options: z
    .array(z.string())
    .default([])
    .describe("contrast and apply_it: 2 to 4 short options"),
  answer: z
    .number()
    .int()
    .default(0)
    .describe("contrast and apply_it: index of the right option"),
  formula: z
    .string()
    .default("")
    .describe("which_formula: id of the right formula"),
  why: z
    .string()
    .default("")
    .describe("Why the answer is right, one or two sentences"),
  groups: z
    .array(z.string())
    .default([])
    .describe("sort_it: 2 or 3 group names"),
  cards: z
    .array(
      z.object({
        text: z.string(),
        group: z.number().int().describe("Index into groups"),
        why: z.string().default(""),
      }),
    )
    .default([])
    .describe("sort_it: 4 to 8 short cards"),
  lines: z
    .array(z.string())
    .default([])
    .describe("spot_slip: the worked answer, 3 to 6 lines, one of them wrong"),
  wrongLine: z
    .number()
    .int()
    .default(-1)
    .describe("spot_slip: index of the wrong line"),
  fix: z.string().default("").describe("spot_slip: the wrong line done right"),
  answerExpr: z
    .string()
    .default("")
    .describe(
      "twin_problem: the sum, with numbers and + - * / ^ ( ) sqrt only",
    ),
  steps: z
    .array(z.string())
    .default([])
    .describe(
      "twin_problem: the steps in words or plain maths, without results",
    ),
  clipAt: clock,
});

export const writtenReviewSchema = z.object({
  pieces: z.array(writtenPieceSchema).default([]),
});
export type WrittenReview = z.infer<typeof writtenReviewSchema>;
type WrittenPiece = WrittenReview["pieces"][number];

/** The sheet as the AI sees it, every item with an id to name. */
export function reviewMaterial(sheet: LessonSheet): {
  material: Record<string, unknown>;
  ids: Set<string>;
} {
  const ids = new Set<string>();
  const id = (kind: string, index: number) => {
    const value = `${kind}:${index}`;
    ids.add(value);
    return value;
  };
  const time = (ms: number | null) => (ms === null ? "" : formatClock(ms));
  const material: Record<string, unknown> = {
    topic: sheet.topic,
    summary: sheet.summary,
    words: sheet.vocabulary.slice(0, 40).map((word, index) => ({
      id: id("word", index),
      term: word.term,
      meaning: word.meaning,
    })),
    patterns: sheet.patterns.map((pattern, index) => ({
      id: id("pattern", index),
      pattern: pattern.pattern,
      explanation: pattern.explanation,
      examples: pattern.examples.map((example) => ({
        text: example.text,
        translation: example.translation,
        at: time(example.atMs),
      })),
    })),
    terms: sheet.keyTerms.map((term, index) => ({
      id: id("term", index),
      term: term.term,
      definition: term.definition,
      at: time(term.heardAtMs),
    })),
    ideas: sheet.ideas.map((idea, index) => ({
      id: id("idea", index),
      idea: idea.title,
      explanation: idea.explanation,
      example: idea.example,
      at: time(idea.exampleAtMs),
    })),
    sources: sheet.sources.map((source, index) => ({
      id: id("source", index),
      name: source.name,
      note: source.note,
    })),
    formulas: sheet.formulas.map((formula, index) => ({
      id: id("formula", index),
      name: formula.name,
      latex: formula.latex,
      whenToUse: formula.whenToUse,
      at: time(formula.atMs),
    })),
    workedExamples: sheet.workedExamples.map((example, index) => ({
      id: id("example", index),
      problem: example.problem,
      steps: example.steps.map((step) => step.text),
      answer: example.answer,
      at: time(example.atMs),
    })),
    problems: sheet.problems.map((problem, index) => ({
      id: id("problem", index),
      question: problem.question,
      answer: problem.answer,
      at: time(problem.atMs),
    })),
    slips: sheet.corrections.map((slip, index) => ({
      id: id("slip", index),
      said: slip.said,
      right: slip.corrected,
      why: slip.why,
      at: time(slip.atMs),
    })),
  };
  for (const [key, value] of Object.entries(material)) {
    if (Array.isArray(value) && value.length === 0) delete material[key];
    if (value === "") delete material[key];
  }
  return { material, ids };
}

const KIND_LINES: Record<WrittenKind, string> = {
  contrast:
    "- contrast: two things from the class that are easy to mix up (two patterns, two terms). A short situation and two or three options; exactly one fits.",
  apply_it:
    "- apply_it: a short new case, two to four sentences, that one idea or term from the class explains. Three options from the class's terms and ideas; exactly one fits.",
  sort_it:
    "- sort_it: two or three groups taken from the class and four to eight short cards from the class that belong to them. A card never contains its group's name, or it sorts itself.",
  which_formula:
    "- which_formula: a short new situation where one of the class's formulas is the tool to use; give its id as formula.",
  twin_problem:
    "- twin_problem: a problem from the class with new, simple numbers. Give the sum as answerExpr with numbers and + - * / ^ ( ) sqrt only, and never work it out yourself. Steps without their results.",
  spot_slip:
    "- spot_slip: a worked answer from the class in three to six short lines, with exactly one line made wrong the way students often get it wrong. Say which line, and give it done right as fix.",
};

export function writtenReviewPrompt({
  subject,
  subjectName,
  explainIn,
}: {
  subject: LessonSubject;
  subjectName: string;
  explainIn: string;
}): string {
  const line = subjectName.trim()
    ? `about ${subjectName.trim()}`
    : subject === "language"
      ? "a language lesson"
      : subject === "maths"
        ? "a maths or science class"
        : "a class on a topic";
  return `You write a few practice pieces for a short review of one class, for a student who recorded it. This class is ${line}.
Use only the class material you are given. Every piece names the items it is built from in "from", by their ids. Do not bring in facts, sources, dates or examples the class did not have, except the new cases, situations and numbers the pieces below ask for.
Write the pieces in ${explainIn}. Words, sentences and examples in the language the class teaches stay as they are.
Write only these kinds of pieces, and only when the material gives you enough for one:
${KINDS_FOR[subject].map((kind) => KIND_LINES[kind]).join("\n")}
Give clipAt: the time in the class where the teacher explains the point, as "mm:ss", taken from the material.
Write at most ${MAX_PIECES[subject]} pieces. A few good pieces beat many thin ones. Keep every line short.

Reply with one JSON object and nothing else, matching this JSON schema:
${JSON.stringify(z.toJSONSchema(writtenReviewSchema))}`;
}

function face(text: string): ReviewFace {
  return { text: inlineMathToText(text.trim()) };
}

const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Whether a card gives its group away by naming it, as 一碗汤面 does under 碗. */
export function namesItsGroup(text: string, group: string | undefined) {
  const name = group?.trim().toLowerCase();
  if (!name) return false;
  const card = text.toLowerCase();
  // One character of Chinese is a whole word; one Latin letter is too short.
  if (UNSPACED_SCRIPT.test(name)) return card.includes(name);
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(card);
}

function cleanList(values: string[]): string[] | null {
  const cleaned = values.map((value) => value.trim());
  if (cleaned.some((value) => !value)) return null;
  if (
    new Set(cleaned.map((value) => value.toLowerCase())).size !== cleaned.length
  ) {
    return null;
  }
  return cleaned;
}

/**
 * Turns what the AI wrote into pieces, dropping any that name nothing in the
 * lesson, don't add up or are malformed.
 */
export function writtenDrafts(
  written: WrittenReview,
  {
    sheet,
    subject,
    ids,
    clips,
    teacher,
  }: {
    sheet: LessonSheet;
    subject: LessonSubject;
    ids: Set<string>;
    clips: ReviewClipSource;
    teacher: string;
  },
): ReviewDraft[] {
  const allowed = new Set<WrittenKind>(KINDS_FOR[subject]);
  const label = teacher.trim() || t`Teacher`;
  const drafts: ReviewDraft[] = [];
  const seen = new Set<string>();
  for (const piece of written.pieces) {
    if (!allowed.has(piece.piece)) continue;
    const from = piece.from.filter((value) => ids.has(value));
    if (from.length === 0) continue;
    const draft = toDraft(piece, from, sheet, label, clips);
    if (!draft) continue;
    const key = `${draft.kind}|${draft.prompt}|${JSON.stringify(draft.body)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(draft);
  }
  return drafts;
}

function toDraft(
  piece: WrittenPiece,
  from: string[],
  sheet: LessonSheet,
  teacher: string,
  clips: ReviewClipSource,
): ReviewDraft | null {
  const clip = clipOf(clips.speech(parseClock(piece.clipAt), 15_000), teacher);
  const base = {
    written: true,
    explain: inlineMathToText(piece.why.trim()),
    clips: clip ? [clip] : [],
    cardId: null,
    markId: null,
  };
  const situation = piece.situation.trim();
  switch (piece.piece) {
    case "contrast":
    case "apply_it": {
      const options = cleanList(piece.options);
      if (!options || options.length < 2 || options.length > 4) return null;
      if (!situation || piece.answer < 0 || piece.answer >= options.length) {
        return null;
      }
      const order = seededOrder(options.length, situation);
      return {
        ...base,
        kind: piece.piece,
        source:
          piece.piece === "apply_it"
            ? t`New case, written for review`
            : t`Situation written for review`,
        prompt:
          piece.ask.trim() ||
          (piece.piece === "apply_it"
            ? t`Which idea fits this case best?`
            : t`Which one fits?`),
        body: {
          type: "choice",
          context: face(situation),
          listen: null,
          options: order.map((index) => face(options[index]!)),
          answer: order.indexOf(piece.answer),
          reveal: [],
        },
      };
    }
    case "sort_it": {
      const groups = cleanList(piece.groups);
      if (!groups || groups.length < 2 || groups.length > 3) return null;
      const cards = piece.cards
        .map((card) => ({
          text: card.text.trim(),
          group: card.group,
          why: card.why.trim(),
        }))
        .filter(
          (card) => card.text && !namesItsGroup(card.text, groups[card.group]),
        );
      if (cards.length < 4 || cards.length > 8) return null;
      if (cards.some((card) => card.group < 0 || card.group >= groups.length)) {
        return null;
      }
      if (
        groups.some((_, index) => !cards.some((card) => card.group === index))
      ) {
        return null;
      }
      if (
        new Set(cards.map((card) => card.text.toLowerCase())).size !==
        cards.length
      ) {
        return null;
      }
      const order = seededOrder(cards.length, groups.join("|"));
      return {
        ...base,
        kind: "sort_it",
        source: t`Sorted from the lesson`,
        prompt: piece.ask.trim() || t`Put each card where it belongs.`,
        body: {
          type: "sort",
          groups: groups.map((title) => ({ title, hint: "" })),
          cards: order.map((index) => cards[index]!),
        },
      };
    }
    case "which_formula": {
      const formulas = sheet.formulas.filter((formula) => formula.latex.trim());
      const right = /^formula:(\d+)$/.exec(piece.formula.trim());
      const rightIndex = right ? Number(right[1]) : -1;
      if (!situation || formulas.length < 2) return null;
      if (!sheet.formulas[rightIndex]?.latex.trim()) return null;
      const chosen = [
        sheet.formulas[rightIndex]!,
        ...formulas.filter((formula) => formula !== sheet.formulas[rightIndex]),
      ].slice(0, 4);
      const order = seededOrder(chosen.length, situation);
      return {
        ...base,
        kind: "which_formula",
        source: t`Situation written for review`,
        prompt: piece.ask.trim() || t`Which formula is the tool here?`,
        body: {
          type: "choice",
          context: face(situation),
          listen: null,
          options: order.map((index) => ({
            text: chosen[index]!.name.trim(),
            latex: chosen[index]!.latex,
            sub: latexToText(chosen[index]!.latex),
          })),
          answer: order.indexOf(0),
          reveal: [],
        },
      };
    }
    case "twin_problem": {
      const value = evaluateExpression(piece.answerExpr);
      if (value === null || !situation) return null;
      if (!from.some((id) => /^(problem|example):/.test(id))) return null;
      // A sum that can't be typed back to itself would never be marked right.
      if (!answerMatches(formatAnswer(value), value)) return null;
      return {
        ...base,
        kind: "twin_problem",
        source: t`A problem from class with new numbers, worked out by Mirna`,
        prompt: piece.ask.trim() || t`Work it out.`,
        body: {
          type: "number",
          context: face(situation),
          steps: piece.steps
            .map((step) => step.trim())
            .filter(Boolean)
            .slice(0, 6)
            .map(face),
          answer: value,
          answerText: formatAnswer(value),
        },
      };
    }
    case "spot_slip": {
      const lines = piece.lines.map((line) => line.trim()).filter(Boolean);
      if (lines.length < 3 || lines.length > 6) return null;
      if (piece.wrongLine < 0 || piece.wrongLine >= lines.length) return null;
      if (!piece.fix.trim()) return null;
      const example = from
        .map((id) => /^example:(\d+)$/.exec(id))
        .find(Boolean);
      const problem = example
        ? sheet.workedExamples[Number(example[1])]?.problem.trim()
        : "";
      return {
        ...base,
        kind: "spot_slip",
        source: t`Worked answer from class, one line made wrong`,
        prompt: piece.ask.trim() || t`One line is wrong. Which one?`,
        body: {
          type: "choice",
          context: situation || problem ? face(situation || problem!) : null,
          listen: null,
          options: lines.map(face),
          answer: piece.wrongLine,
          reveal: [face(piece.fix)],
        },
      };
    }
  }
}

/**
 * Asks the AI for the written pieces. Streamed, as the study sheet is, so a
 * slow answer keeps the connection busy.
 */
export async function writeReviewPieces({
  model,
  sheet,
  subject,
  subjectName,
  explainIn,
  signal,
}: {
  model: LanguageModel;
  sheet: LessonSheet;
  subject: LessonSubject;
  subjectName: string;
  explainIn: string;
  signal?: AbortSignal;
}): Promise<WrittenReview> {
  const { material } = reviewMaterial(sheet);
  let streamError: unknown;
  const result = streamText({
    model,
    system: writtenReviewPrompt({ subject, subjectName, explainIn }),
    prompt: JSON.stringify(material),
    output: Output.object({ schema: writtenReviewSchema }),
    maxRetries: 2,
    maxOutputTokens: sheetMaxOutputTokens(model),
    timeout: { totalMs: 180_000 },
    abortSignal: signal,
    onError: ({ error }) => {
      streamError ??= error;
    },
  });
  try {
    const output = (await result.output) as WrittenReview | undefined;
    return output ?? { pieces: [] };
  } catch (error) {
    throw streamError ?? error;
  }
}
