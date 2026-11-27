import { t } from "@lingui/core/macro";

import type { ClipRange } from "../clips";
import { practiceCardId } from "../practice";
import { formatClock } from "../time";
import type {
  LessonFixesDocument,
  LessonMarksDocument,
  LessonPracticeDocument,
  LessonSettings,
  LessonSheet,
  LessonSubject,
} from "../types";
import type { ReviewClipSource } from "./clip-source";
import { inlineMathToText, latexToText } from "./latex-text";
import type { ReviewClip, ReviewFace, ReviewPiece } from "./types";

/** A piece before the plan gives it an id, a place and a length. */
export type ReviewDraft = Omit<ReviewPiece, "id" | "core" | "seconds">;

export type ReviewInput = {
  sheet: LessonSheet;
  settings: LessonSettings;
  subject: LessonSubject;
  marks: LessonMarksDocument | null;
  practice: LessonPracticeDocument | null;
  fixes: LessonFixesDocument | null;
  clips: ReviewClipSource;
  /** The teacher's name for clip buttons; empty for "Teacher". */
  teacher: string;
  now: Date;
};

export function clipOf(
  range: ClipRange | null | undefined,
  label: string,
): ReviewClip | null {
  if (!range || !(range.endMs > range.startMs)) return null;
  const startMs = Math.max(0, Math.round(range.startMs));
  const endMs = Math.round(range.endMs);
  const channel = range.channel ?? null;
  return {
    id: `c${startMs}-${endMs}-${channel ?? "b"}`,
    startMs,
    endMs,
    channel,
    label,
  };
}

function clips(...found: (ReviewClip | null)[]): ReviewClip[] {
  const seen = new Set<string>();
  return found.filter((clip): clip is ReviewClip => {
    if (!clip || seen.has(clip.id)) return false;
    seen.add(clip.id);
    return true;
  });
}

function at(ms: number | null | undefined): string {
  return typeof ms === "number" ? formatClock(ms) : "";
}

/** A stable pseudo-random order for a seed, so a plan always shows the same. */
export function seededOrder(count: number, seed: string): number[] {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    const other = state % (index + 1);
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  return order;
}

/** A shown order that never starts out right. */
export function shuffledOrder(count: number, seed: string): number[] {
  const order = seededOrder(count, seed);
  if (count > 1 && order.every((value, index) => value === index)) {
    order.push(order.shift()!);
  }
  return order;
}

/** How much a card needs practice: missed and due ones first. */
function needOf(
  practice: LessonPracticeDocument | null,
  cardId: string,
  now: Date,
): number {
  const state = practice?.cards[cardId];
  if (!state) return 1;
  const due = new Date(state.due).getTime() <= now.getTime();
  return (state.lapses > 0 ? 2 : 0) + (due ? 1 : 0) - (state.reps > 2 ? 1 : 0);
}

function byNeed<T>(
  items: T[],
  cardOf: (item: T) => string,
  input: ReviewInput,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      need: needOf(input.practice, cardOf(item), input.now),
    }))
    .sort((a, b) => b.need - a.need || a.index - b.index)
    .map((entry) => entry.item);
}

function teacherLabel(input: ReviewInput): string {
  return input.teacher.trim() || t`Teacher`;
}

export function bigPictureDrafts(input: ReviewInput): ReviewDraft[] {
  const { sheet } = input;
  const summary = sheet.summary.trim();
  const chapters = sheet.chapters.filter((chapter) => chapter.title.trim());
  if (!summary || chapters.length < 2) return [];
  const back: ReviewFace[] = [{ text: summary }];
  for (const chapter of chapters.slice(0, 8)) {
    back.push({
      text: chapter.title.trim(),
      sub: formatClock(chapter.startMs),
    });
  }
  return [
    {
      kind: "big_picture",
      written: false,
      source: t`From the study sheet`,
      prompt: t`In one breath: what was this class about?`,
      body: { type: "reveal", front: null, back },
      explain: "",
      clips: clips(
        ...chapters
          .slice(0, 6)
          .map((chapter) =>
            clipOf(
              input.clips.speech(chapter.startMs, 15_000),
              chapter.title.trim(),
            ),
          ),
      ),
      cardId: null,
      markId: null,
    },
  ];
}

export function termDrafts(input: ReviewInput): ReviewDraft[] {
  const { sheet } = input;
  const teacher = teacherLabel(input);
  const terms = byNeed(
    sheet.keyTerms.filter((term) => term.term.trim() && term.definition.trim()),
    (term) => practiceCardId("term", term.term),
    input,
  );
  return terms.map((term) => {
    const example = sheet.ideas.find(
      (idea) =>
        idea.example.trim() &&
        idea.terms.some(
          (name) =>
            name.trim().toLowerCase() === term.term.trim().toLowerCase(),
        ),
    );
    const back: ReviewFace[] = [
      { text: term.definition.trim(), sub: t`In ${teacher}'s words` },
    ];
    if (example) {
      back.push({
        text: example.example.trim(),
        sub: t`Example used in class`,
      });
    }
    return {
      kind: "explain_it",
      written: false,
      source:
        term.heardAtMs !== null
          ? t`Key term · explained at ${at(term.heardAtMs)}`
          : t`Key term`,
      prompt: t`What does it mean? Use your own words.`,
      body: { type: "reveal", front: { text: term.term.trim() }, back },
      explain: "",
      clips: clips(
        clipOf(
          input.clips.speech(term.heardAtMs, 15_000) ??
            input.clips.term(term.term, term.heardAtMs),
          teacher,
        ),
      ),
      cardId: practiceCardId("term", term.term),
      markId: null,
    };
  });
}

export function patternDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  return input.sheet.patterns
    .filter((pattern) => pattern.pattern.trim() && pattern.explanation.trim())
    .map((pattern) => {
      const examples = pattern.examples
        .filter((example) => example.text.trim())
        .slice(0, 2);
      return {
        kind: "explain_it",
        written: false,
        source: t`Pattern from class`,
        prompt: t`How does this pattern work? Say an example.`,
        body: {
          type: "reveal",
          front: { text: pattern.pattern.trim(), learning: true },
          back: [
            { text: pattern.explanation.trim() },
            ...examples.map((example) => ({
              text: example.text.trim(),
              sub: example.translation.trim() || undefined,
              learning: true,
            })),
          ],
        },
        explain: "",
        clips: clips(
          ...examples.map((example) =>
            clipOf(input.clips.speech(example.atMs, 8_000), teacher),
          ),
        ),
        cardId: null,
        markId: null,
      };
    });
}

export function quickFireDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  if (input.subject === "language") {
    const words = byNeed(
      input.sheet.vocabulary.filter(
        (word) => word.term.trim() && word.meaning.trim(),
      ),
      (word) => practiceCardId("word", word.term),
      input,
    );
    if (words.length < 3) return [];
    const chunks = [words.slice(0, 6), words.slice(6, 12)].filter(
      (chunk) => chunk.length >= 3,
    );
    return chunks.map((chunk) => ({
      kind: "quick_fire" as const,
      written: false,
      source: t`${chunk.length} words from this lesson`,
      prompt: t`Say what it means before you turn the card.`,
      body: {
        type: "cards" as const,
        items: chunk.map((word) => ({
          front: {
            text: word.term.trim(),
            reading: word.reading.trim() || undefined,
            learning: true,
          },
          back: {
            text: word.meaning.trim(),
            sub: word.note.trim() || undefined,
          },
          clip: clipOf(input.clips.term(word.term, word.heardAtMs), teacher),
          cardId: practiceCardId("word", word.term),
        })),
      },
      explain: "",
      clips: [],
      cardId: null,
      markId: null,
    }));
  }
  const terms = byNeed(
    input.sheet.keyTerms.filter(
      (term) => term.term.trim() && term.definition.trim(),
    ),
    (term) => practiceCardId("term", term.term),
    input,
  );
  // The first terms get their own Explain it; the rest go quickly.
  const rest = terms.slice(3, 9);
  if (rest.length < 3) return [];
  return [
    {
      kind: "quick_fire",
      written: false,
      source: t`${rest.length} key terms from this lesson`,
      prompt: t`Say what each one means, then turn the card.`,
      body: {
        type: "cards",
        items: rest.map((term) => ({
          front: { text: term.term.trim() },
          back: { text: term.definition.trim() },
          clip: clipOf(input.clips.speech(term.heardAtMs, 12_000), teacher),
          cardId: practiceCardId("term", term.term),
        })),
      },
      explain: "",
      clips: [],
      cardId: null,
      markId: null,
    },
  ];
}

export function formulaDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  const formulas = byNeed(
    input.sheet.formulas.filter((formula) => formula.name.trim()),
    (formula) => practiceCardId("formula", formula.name),
    input,
  );
  return formulas.map((formula) => {
    const latex =
      input.fixes?.formulas[formula.name]?.latex || formula.latex || "";
    const back: ReviewFace[] = [{ text: latexToText(latex), latex }];
    for (const symbol of formula.symbols.slice(0, 5)) {
      back.push({
        text: `${latexToText(symbol.symbol)}: ${symbol.meaning.trim()}`,
      });
    }
    if (formula.whenToUse.trim()) {
      back.push({ text: formula.whenToUse.trim(), sub: t`When to use it` });
    }
    return {
      kind: "from_memory",
      written: false,
      source:
        formula.from === "notes"
          ? t`Formula from your notes`
          : formula.atMs !== null
            ? t`Formula · explained at ${at(formula.atMs)}`
            : t`Formula`,
      prompt: t`Write it out on paper, then check.`,
      body: { type: "reveal", front: { text: formula.name.trim() }, back },
      explain: "",
      clips: clips(clipOf(input.clips.speech(formula.atMs, 15_000), teacher)),
      cardId: practiceCardId("formula", formula.name),
      markId: null,
    };
  });
}

export function listenDrafts(input: ReviewInput): ReviewDraft[] {
  if (input.subject !== "language") return [];
  const teacher = teacherLabel(input);
  const sentences = input.sheet.patterns.flatMap((pattern) =>
    pattern.examples
      .filter(
        (example) =>
          example.text.trim() &&
          example.translation.trim() &&
          example.atMs !== null,
      )
      .map((example) => ({ ...example, pattern })),
  );
  const meanings = [
    ...sentences.map((sentence) => sentence.translation.trim()),
    ...input.sheet.translations.map((item) => item.translation.trim()),
  ].filter(Boolean);
  const drafts: ReviewDraft[] = [];
  for (const sentence of sentences.slice(0, 3)) {
    const listen = clipOf(input.clips.speech(sentence.atMs, 8_000), teacher);
    if (!listen) continue;
    const right = sentence.translation.trim();
    const others = [
      ...new Set(meanings.filter((meaning) => meaning !== right)),
    ];
    if (others.length < 2) continue;
    const picked = seededOrder(others.length, right)
      .slice(0, 2)
      .map((index) => others[index]!);
    const pool = [right, ...picked];
    const order = seededOrder(pool.length, `${right}|choice`);
    drafts.push({
      kind: "listen_pick",
      written: false,
      source: t`${teacher} at ${at(sentence.atMs)}`,
      prompt: t`Listen. What did ${teacher} say?`,
      body: {
        type: "choice",
        context: null,
        listen,
        options: order.map((index) => ({ text: pool[index]! })),
        answer: order.indexOf(0),
        reveal: [{ text: sentence.text.trim(), sub: right, learning: true }],
      },
      explain: sentence.pattern.explanation.trim(),
      clips: clips(listen),
      cardId: null,
      markId: null,
    });
  }
  return drafts;
}

export function markDrafts(input: ReviewInput): ReviewDraft[] {
  const answers = new Map(
    input.sheet.markAnswers.map((entry) => [entry.markId, entry.answer.trim()]),
  );
  return (input.marks?.marks ?? [])
    .filter((mark) => mark.kind === "confused" && answers.get(mark.id))
    .map((mark) => ({
      kind: "replay_mark" as const,
      written: false,
      source: t`You marked this at ${at(mark.atMs)}`,
      prompt: t`You marked this in class. Can you explain it now?`,
      body: {
        type: "reveal" as const,
        front: {
          text: mark.note.trim() || t`The moment you marked`,
          sub: formatClock(mark.atMs),
        },
        back: [{ text: answers.get(mark.id)! }],
      },
      explain: "",
      clips: clips(
        clipOf(input.clips.speech(mark.atMs, 30_000), t`From your mark`),
      ),
      cardId: null,
      markId: mark.id,
    }));
}

export function slipDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  const language = input.subject === "language";
  return input.sheet.corrections
    .filter((item) => item.said.trim() && item.corrected.trim())
    .slice(0, 4)
    .map((item) => {
      const found = input.clips.correction(item.atMs);
      return {
        kind: "fix_it" as const,
        written: false,
        source:
          item.atMs !== null ? t`Your slip at ${at(item.atMs)}` : t`Your slip`,
        prompt: language
          ? t`You said this in class. How should it be?`
          : t`This went wrong in class. What is right?`,
        body: {
          type: "reveal" as const,
          front: {
            text: inlineMathToText(item.said.trim()),
            struck: true,
            learning: language,
          },
          back: [
            {
              text: inlineMathToText(item.corrected.trim()),
              learning: language,
            },
            ...(item.why.trim()
              ? [{ text: inlineMathToText(item.why.trim()) }]
              : []),
          ],
        },
        explain: "",
        clips: clips(clipOf(found.you, t`You`), clipOf(found.teacher, teacher)),
        cardId: null,
        markId: null,
      };
    });
}

export function questionDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  return byNeed(
    input.sheet.checkYourself.filter(
      (item) => item.question.trim() && item.answer.trim(),
    ),
    (item) => practiceCardId("question", item.question),
    input,
  ).map((item) => ({
    kind: "check_yourself" as const,
    written: false,
    source: t`Check yourself`,
    prompt: inlineMathToText(item.question.trim()),
    body: {
      type: "reveal" as const,
      front: null,
      back: [{ text: inlineMathToText(item.answer.trim()) }],
    },
    explain: "",
    clips: clips(clipOf(input.clips.speech(item.atMs, 15_000), teacher)),
    cardId: practiceCardId("question", item.question),
    markId: null,
  }));
}

export function orderDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  const drafts: ReviewDraft[] = [];
  for (const method of input.sheet.methods) {
    const steps = method.steps.filter((step) => step.text.trim());
    if (steps.length < 3 || steps.length > 7) continue;
    drafts.push({
      kind: "in_order",
      written: false,
      source:
        method.atMs !== null
          ? t`Steps from class at ${at(method.atMs)}`
          : t`Steps from class`,
      prompt: t`Put the steps in order: ${method.title.trim()}`,
      body: {
        type: "order",
        context: null,
        items: steps.map((step) => ({
          text: inlineMathToText(step.text.trim()),
        })),
        shuffled: shuffledOrder(steps.length, method.title),
      },
      explain: "",
      clips: clips(clipOf(input.clips.speech(method.atMs, 15_000), teacher)),
      cardId: null,
      markId: null,
    });
  }
  for (const example of input.sheet.workedExamples) {
    const steps = example.steps.filter((step) => step.text.trim());
    if (steps.length < 3 || steps.length > 6) continue;
    drafts.push({
      kind: "in_order",
      written: false,
      source:
        example.atMs !== null
          ? t`Worked example at ${at(example.atMs)}`
          : t`Worked example`,
      prompt: t`Put the steps of the worked example in order.`,
      body: {
        type: "order",
        context: { text: inlineMathToText(example.problem.trim()) },
        items: steps.map((step) => ({
          text: inlineMathToText(step.text.trim()),
        })),
        shuffled: shuffledOrder(steps.length, example.problem),
      },
      explain: example.answer.trim()
        ? t`Answer: ${inlineMathToText(example.answer.trim())}`
        : "",
      clips: clips(clipOf(input.clips.speech(example.atMs, 15_000), teacher)),
      cardId: null,
      markId: null,
    });
  }
  return drafts;
}

const NUMBER_ANSWER =
  /^\s*(?:[\p{L}]{1,3}\s*[=≈]\s*)?[≈~]?\s*(-?\d+(?:[.,]\d+)?)\s*(?:[\p{L}%°²³]{0,6})\s*$/u;

/** The number in an answer like "z = 2", "≈ 4.57" or "12 cm", if it is one. */
export function numericAnswer(answer: string): number | null {
  const match = NUMBER_ANSWER.exec(inlineMathToText(answer));
  if (!match) return null;
  const value = Number(match[1]!.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function problemDrafts(input: ReviewInput): ReviewDraft[] {
  const teacher = teacherLabel(input);
  return input.sheet.problems
    .filter((problem) => problem.question.trim() && problem.answer.trim())
    .map((problem) => {
      const steps = problem.steps
        .filter((step) => step.trim())
        .map((step) => ({ text: inlineMathToText(step.trim()) }));
      const value = numericAnswer(problem.answer);
      const answerText = inlineMathToText(problem.answer.trim());
      return {
        kind: "problem" as const,
        written: false,
        source:
          problem.atMs !== null
            ? t`Problem set in class at ${at(problem.atMs)}`
            : t`Problem from class`,
        prompt: t`Work it out.`,
        body:
          value !== null
            ? {
                type: "number" as const,
                context: { text: inlineMathToText(problem.question.trim()) },
                steps,
                answer: value,
                answerText,
              }
            : {
                type: "reveal" as const,
                front: { text: inlineMathToText(problem.question.trim()) },
                back: [...steps, { text: answerText, sub: t`Answer` }],
              },
        explain: "",
        clips: clips(clipOf(input.clips.speech(problem.atMs, 15_000), teacher)),
        cardId: practiceCardId("problem", problem.question),
        markId: null,
      };
    });
}

/** Every piece the lesson itself offers, without any AI. */
export function lessonDrafts(input: ReviewInput): ReviewDraft[] {
  return [
    ...bigPictureDrafts(input),
    ...termDrafts(input),
    ...(input.subject === "language" ? patternDrafts(input) : []),
    ...quickFireDrafts(input),
    ...formulaDrafts(input),
    ...listenDrafts(input),
    ...markDrafts(input),
    ...slipDrafts(input),
    ...questionDrafts(input),
    ...orderDrafts(input),
    ...problemDrafts(input),
  ];
}
