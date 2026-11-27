import { describe, expect, it } from "vitest";

import type { LessonSheet, LessonSubject } from "../types";
import { answerMatches, evaluateExpression, formatAnswer } from "./arith";
import { NO_CLIPS, type ReviewClipSource } from "./clip-source";
import {
  lessonDrafts,
  numericAnswer,
  type ReviewInput,
  shuffledOrder,
} from "./drafts";
import { inlineMathToText, latexToText } from "./latex-text";
import { assemblePlan } from "./plan";
import { applyReviewRun, cardsOutcome, intoPractice } from "./results";
import { morePieces, piecesFor, reviewSeconds, type ReviewRun } from "./types";
import { namesItsGroup, reviewMaterial, writtenDrafts } from "./written";

function sheetOf(partial: Partial<LessonSheet>): LessonSheet {
  return {
    version: 1,
    kind: "language",
    topic: "",
    summary: "",
    chapters: [],
    vocabulary: [],
    patterns: [],
    corrections: [],
    homework: [],
    markAnswers: [],
    openQuestions: [],
    translations: [],
    talk: null,
    keyTerms: [],
    ideas: [],
    sources: [],
    methods: [],
    checkYourself: [],
    formulas: [],
    workedExamples: [],
    problems: [],
    ...partial,
  };
}

const CLIPS: ReviewClipSource = {
  term: (_term, aroundMs) =>
    aroundMs === null ? null : { startMs: aroundMs, endMs: aroundMs + 1500 },
  speech: (atMs) =>
    atMs === null ? null : { startMs: atMs, endMs: atMs + 6000, channel: 1 },
  correction: (atMs) =>
    atMs === null
      ? { you: null, teacher: null }
      : {
          you: { startMs: atMs - 3000, endMs: atMs - 500, channel: 0 },
          teacher: { startMs: atMs, endMs: atMs + 3000, channel: 1 },
        },
};

function inputOf(
  sheet: LessonSheet,
  subject: LessonSubject,
  extra: Partial<ReviewInput> = {},
): ReviewInput {
  return {
    sheet,
    settings: {
      learning: subject === "language" ? "zh" : "en",
      explainIn: "en",
      subject,
    },
    subject,
    marks: null,
    practice: null,
    fixes: null,
    clips: CLIPS,
    teacher: "Lǎoshī Chen",
    now: new Date("2026-11-27T10:00:00Z"),
    ...extra,
  };
}

const WORDS = [
  ["饺子", "jiǎozi", "dumplings", 1_400_000],
  ["面条", "miàntiáo", "noodles", 1_378_000],
  ["好吃", "hǎochī", "tasty", 1_379_000],
  ["都", "dōu", "all, both", 1_275_000],
  ["美国人", "Měiguó rén", "American", 1_812_000],
  ["法国人", "Fǎguó rén", "French", 1_820_000],
  ["也", "yě", "also", 1_120_000],
].map(([term, reading, meaning, heardAtMs]) => ({
  term: term as string,
  reading: reading as string,
  meaning: meaning as string,
  note: "",
  heardAtMs: heardAtMs as number,
  isNew: true,
}));

const LANGUAGE_SHEET = sheetOf({
  summary: "都 with verbs and adjectives, and 都不 against 不都.",
  vocabulary: WORDS,
  patterns: [
    {
      pattern: "Subject + 都 + verb",
      explanation: "都 comes after everything it sums up.",
      examples: [
        {
          text: "面条和饺子都很好吃。",
          translation: "Noodles and dumplings are both tasty.",
          atMs: 1_378_000,
        },
        {
          text: "我们也都喝茶。",
          translation: "We all drink tea too.",
          atMs: 1_120_000,
        },
      ],
    },
    {
      pattern: "都不 or 不都",
      explanation: "都不 is none; 不都 is not all.",
      examples: [
        {
          text: "他们都不是中国人。",
          translation: "None of them are Chinese.",
          atMs: 1_416_000,
        },
      ],
    },
  ],
  corrections: [
    {
      said: "我们都也喝茶",
      corrected: "我们也都喝茶",
      why: "也 before 都.",
      atMs: 1_862_000,
    },
  ],
});

describe("arithmetic for new problems", () => {
  it("works out sums the AI writes", () => {
    expect(evaluateExpression("(190 - 172) / 8")).toBe(2.25);
    expect(evaluateExpression("32 ÷ 7")).toBeCloseTo(4.5714, 3);
    expect(evaluateExpression("sqrt(4.57)")).toBeCloseTo(2.1378, 3);
    expect(evaluateExpression("2^3^2")).toBe(512);
    expect(evaluateExpression("-3 + 2 × (4 − 1)")).toBe(3);
    expect(evaluateExpression("√16 + 1")).toBe(5);
  });

  it("refuses anything that isn't plain arithmetic", () => {
    expect(evaluateExpression("x + 1")).toBeNull();
    expect(evaluateExpression("alert(1)")).toBeNull();
    expect(evaluateExpression("1 / 0")).toBeNull();
    expect(evaluateExpression("(1 + 2")).toBeNull();
    expect(evaluateExpression("")).toBeNull();
  });

  it("accepts typed answers that are rounded", () => {
    expect(formatAnswer(32 / 7)).toBe("4.571");
    expect(answerMatches("4.57", 32 / 7)).toBe(true);
    expect(answerMatches("2,25", 2.25)).toBe(true);
    expect(answerMatches("2.3", 2.25)).toBe(false);
    expect(answerMatches("", 0)).toBe(false);
  });
});

describe("formulas as plain text", () => {
  it("turns common LaTeX into something readable", () => {
    expect(latexToText("s^2 = \\frac{\\sum (x - \\bar{x})^2}{n - 1}")).toBe(
      "s² = (Σ (x − x̄)²) / (n − 1)",
    );
    expect(latexToText("z = \\frac{x - \\mu}{\\sigma}")).toBe(
      "z = (x − μ) / σ",
    );
    expect(latexToText("\\bar{x} = \\frac{\\sum x}{n}")).toBe("x̄ = (Σ x) / n");
    expect(latexToText("s = \\sqrt{s^2}")).toBe("s = √s²");
    expect(latexToText("\\sqrt{a + b}")).toBe("√(a + b)");
    expect(latexToText("x_{1} + x_i")).toBe("x₁ + xᵢ");
  });

  it("only touches the maths inside text", () => {
    expect(inlineMathToText("Divide by $n - 1$, not $n$.")).toBe(
      "Divide by n − 1, not n.",
    );
  });
});

describe("numbers in answers", () => {
  it("reads answers that are a number", () => {
    expect(numericAnswer("z = 2")).toBe(2);
    expect(numericAnswer("≈ 4.57")).toBe(4.57);
    expect(numericAnswer("12 cm")).toBe(12);
    expect(numericAnswer("$s \\approx 2.14$")).toBe(2.14);
    expect(numericAnswer("French, by half a deviation")).toBeNull();
  });
});

describe("shown orders", () => {
  it("are stable and never start out right", () => {
    const first = shuffledOrder(4, "steps");
    expect(shuffledOrder(4, "steps")).toEqual(first);
    expect([...first].sort()).toEqual([0, 1, 2, 3]);
    expect(first).not.toEqual([0, 1, 2, 3]);
  });
});

describe("a language review from the sheet alone", () => {
  const plan = assemblePlan({
    subject: "language",
    learning: "zh",
    explainIn: "en",
    drafts: lessonDrafts(inputOf(LANGUAGE_SHEET, "language")),
  });

  it("fits five and ten minutes", () => {
    expect(reviewSeconds(piecesFor(plan, 5))).toBeLessThanOrEqual(300);
    expect(reviewSeconds(piecesFor(plan, 10))).toBeLessThanOrEqual(600);
    expect(piecesFor(plan, 5).length).toBeGreaterThan(2);
  });

  it("goes on for 5 more minutes with only what the 5 minutes left out", () => {
    const first = piecesFor(plan, 5).map((piece) => piece.id);
    const more = morePieces(plan).map((piece) => piece.id);
    expect(more.length).toBeGreaterThan(0);
    expect(more.filter((id) => first.includes(id))).toEqual([]);
    expect([...first, ...more].sort()).toEqual(
      plan.pieces.map((piece) => piece.id).sort(),
    );
  });

  it("drops sort cards that name their own group", () => {
    expect(namesItsGroup("一碗汤面", "碗")).toBe(true);
    expect(namesItsGroup("一碗面条", "盘")).toBe(false);
    expect(namesItsGroup("A sudden supply shock", "Supply")).toBe(true);
    expect(namesItsGroup("Start a business", "Art")).toBe(false);
    expect(namesItsGroup("a card", "A")).toBe(false);

    const { ids } = reviewMaterial(LANGUAGE_SHEET);
    const sorted = (cards: { text: string; group: number }[]) =>
      writtenDrafts(
        {
          pieces: [
            {
              piece: "sort_it",
              from: ["word:1"],
              ask: "Sort these measure-word phrases.",
              situation: "",
              options: [],
              answer: 0,
              formula: "",
              why: "",
              groups: ["碗", "盘"],
              cards: cards.map((card) => ({ ...card, why: "" })),
              lines: [],
              wrongLine: -1,
              fix: "",
              answerExpr: "",
              steps: [],
              clipAt: "",
            },
          ],
        },
        {
          sheet: LANGUAGE_SHEET,
          subject: "language",
          ids,
          clips: CLIPS,
          teacher: "",
        },
      );

    expect(
      sorted([
        { text: "一碗汤面", group: 0 },
        { text: "一盘炒面", group: 1 },
        { text: "一碗面条", group: 0 },
        { text: "一盘饺子", group: 1 },
      ]),
    ).toEqual([]);
    const kept = sorted([
      { text: "汤面", group: 0 },
      { text: "炒面", group: 1 },
      { text: "面条", group: 0 },
      { text: "饺子", group: 1 },
      { text: "一碗米饭", group: 0 },
    ]);
    expect(kept).toHaveLength(1);
    expect(
      kept[0]!.body.type === "sort" &&
        kept[0]!.body.cards.map((card) => card.text).sort(),
    ).toEqual(["汤面", "炒面", "面条", "饺子"].sort());
  });

  it("starts with the ear and puts slips early", () => {
    const kinds = piecesFor(plan, 5).map((piece) => piece.kind);
    expect(kinds[0]).toBe("listen_pick");
    expect(kinds).toContain("fix_it");
    expect(kinds).toContain("quick_fire");
    expect(kinds.indexOf("fix_it")).toBeLessThan(kinds.indexOf("quick_fire"));
  });

  it("never puts two pieces of a kind side by side when it can help it", () => {
    const kinds = plan.pieces.map((piece) => piece.kind);
    const counts = new Map<string, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const most = Math.max(...counts.values());
    if (most <= kinds.length - most + 1) {
      for (let index = 1; index < kinds.length; index++) {
        expect(kinds[index]).not.toBe(kinds[index - 1]);
      }
    }
  });

  it("asks what was heard, with the right answer among the choices", () => {
    const listen = plan.pieces.find((piece) => piece.kind === "listen_pick")!;
    expect(listen.body.type).toBe("choice");
    if (listen.body.type !== "choice") return;
    expect(listen.body.listen?.startMs).toBe(1_378_000);
    expect(listen.body.options).toHaveLength(3);
    expect(listen.body.options[listen.body.answer]!.text).toBe(
      "Noodles and dumplings are both tasty.",
    );
    expect(listen.written).toBe(false);
  });

  it("plays your line and the teacher's for a slip", () => {
    const slip = plan.pieces.find((piece) => piece.kind === "fix_it")!;
    expect(slip.clips.map((clip) => clip.label)).toEqual([
      "You",
      "Lǎoshī Chen",
    ]);
    expect(slip.clips[1]!.channel).toBe(1);
  });

  it("gives every clip a stable id", () => {
    const again = assemblePlan({
      subject: "language",
      learning: "zh",
      explainIn: "en",
      drafts: lessonDrafts(inputOf(LANGUAGE_SHEET, "language")),
    });
    expect(again).toEqual(plan);
    const slip = plan.pieces.find((piece) => piece.kind === "fix_it")!;
    expect(slip.clips[1]!.id).toBe("c1862000-1865000-1");
  });

  it("puts words you missed first in quick-fire", () => {
    const missed = lessonDrafts(
      inputOf(LANGUAGE_SHEET, "language", {
        practice: {
          version: 1,
          cards: {
            也: {
              due: "2026-11-26T10:00:00Z",
              intervalDays: 0,
              ease: 2.3,
              reps: 0,
              lapses: 2,
              lastReviewedAt: "2026-11-26T09:59:00Z",
            },
          },
        },
      }),
    ).find((draft) => draft.kind === "quick_fire")!;
    expect(
      missed.body.type === "cards" && missed.body.items[0]!.front.text,
    ).toBe("也");
  });
});

describe("a topic review", () => {
  const sheet = sheetOf({
    kind: "subject",
    summary: "How Durkheim thought societies hold together.",
    chapters: [
      { title: "Who Durkheim was", startMs: 130_000 },
      { title: "Two kinds of solidarity", startMs: 845_000 },
      { title: "Anomie", startMs: 1_452_000 },
    ],
    keyTerms: [
      {
        term: "Anomie",
        definition: "Normlessness: the rules no longer fit.",
        heardAtMs: 1_452_000,
        isNew: true,
      },
      {
        term: "Organic solidarity",
        definition: "Holding together by needing each other.",
        heardAtMs: 990_000,
        isNew: true,
      },
    ],
    ideas: [
      {
        title: "Anomie comes from change that outruns the rules",
        explanation: "When a society changes faster than its norms…",
        example: "Lottery winners who struggle afterwards.",
        exampleAtMs: 1_600_000,
        terms: ["Anomie"],
      },
    ],
    checkYourself: [
      {
        question: "Why can anomie rise in a boom?",
        answer: "Sudden gains break the limits too.",
        atMs: 1_610_000,
      },
    ],
  });
  const drafts = lessonDrafts(inputOf(sheet, "topic"));

  it("starts with the big picture and explains terms in the teacher's words", () => {
    const plan = assemblePlan({
      subject: "topic",
      learning: "en",
      explainIn: "en",
      drafts,
    });
    expect(plan.pieces[0]!.kind).toBe("big_picture");
    const anomie = plan.pieces.find(
      (piece) =>
        piece.body.type === "reveal" && piece.body.front?.text === "Anomie",
    )!;
    expect(anomie.cardId).toBe("term:Anomie");
    expect(anomie.body.type === "reveal" && anomie.body.back[1]?.text).toBe(
      "Lottery winners who struggle afterwards.",
    );
  });

  it("adds what the AI wrote, but only what names the lesson", () => {
    const { ids } = reviewMaterial(sheet);
    const extra = writtenDrafts(
      {
        pieces: [
          {
            piece: "apply_it",
            from: ["idea:0", "term:0"],
            ask: "",
            situation: "A town's only factory closes…",
            options: ["Anomie", "Alienation", "Mechanical solidarity"],
            answer: 0,
            formula: "",
            why: "The rules that set goals no longer fit.",
            groups: [],
            cards: [],
            lines: [],
            wrongLine: -1,
            fix: "",
            answerExpr: "",
            steps: [],
            clipAt: "33:00",
          },
          {
            piece: "apply_it",
            from: ["idea:9"],
            ask: "",
            situation: "Made up from nothing",
            options: ["A", "B"],
            answer: 0,
            formula: "",
            why: "",
            groups: [],
            cards: [],
            lines: [],
            wrongLine: -1,
            fix: "",
            answerExpr: "",
            steps: [],
            clipAt: "",
          },
          {
            piece: "twin_problem",
            from: ["idea:0"],
            ask: "",
            situation: "Not allowed in a topic review",
            options: [],
            answer: 0,
            formula: "",
            why: "",
            groups: [],
            cards: [],
            lines: [],
            wrongLine: -1,
            fix: "",
            answerExpr: "1 + 1",
            steps: [],
            clipAt: "",
          },
        ],
      },
      { sheet, subject: "topic", ids, clips: CLIPS, teacher: "Dr Okafor" },
    );
    expect(extra).toHaveLength(1);
    const piece = extra[0]!;
    expect(piece.written).toBe(true);
    expect(
      piece.body.type === "choice" &&
        piece.body.options[piece.body.answer]!.text,
    ).toBe("Anomie");
    expect(piece.clips[0]!.startMs).toBe(1_980_000);
    const plan = assemblePlan({
      subject: "topic",
      learning: "en",
      explainIn: "en",
      drafts: [...extra, ...drafts],
    });
    expect(plan.withAi).toBe(true);
    expect(piecesFor(plan, 5).some((entry) => entry.kind === "apply_it")).toBe(
      true,
    );
  });
});

describe("a maths review", () => {
  const sheet = sheetOf({
    kind: "subject",
    formulas: [
      {
        name: "Sample mean",
        latex: "\\bar{x} = \\frac{\\sum x}{n}",
        symbols: [],
        whenToUse: "",
        atMs: 372_000,
        from: "speech",
      },
      {
        name: "z-score",
        latex: "z = \\frac{x - \\mu}{\\sigma}",
        symbols: [{ symbol: "\\mu", meaning: "the mean" }],
        whenToUse: "Compare results on different tests.",
        atMs: 1_990_000,
        from: "speech",
      },
    ],
    problems: [
      {
        question: "Heights have mean 168 cm and SD 9 cm. z of 186 cm?",
        answer: "z = 2",
        steps: ["(186 − 168) ÷ 9"],
        atMs: 2_300_000,
      },
    ],
  });
  const { ids } = reviewMaterial(sheet);

  it("works out new numbers itself and checks the formula named", () => {
    const extra = writtenDrafts(
      {
        pieces: [
          {
            piece: "twin_problem",
            from: ["problem:0"],
            ask: "",
            situation: "Mean 172 cm, SD 8 cm. z of 190 cm?",
            options: [],
            answer: 0,
            formula: "",
            why: "",
            groups: [],
            cards: [],
            lines: [],
            wrongLine: -1,
            fix: "",
            answerExpr: "(190 - 172) / 8",
            steps: ["Take away the mean", "Divide by the SD"],
            clipAt: "38:20",
          },
          {
            piece: "which_formula",
            from: ["formula:1"],
            ask: "",
            situation: "Who did better, on two tests with different means?",
            options: [],
            answer: 0,
            formula: "formula:1",
            why: "It puts both on one scale.",
            groups: [],
            cards: [],
            lines: [],
            wrongLine: -1,
            fix: "",
            answerExpr: "",
            steps: [],
            clipAt: "",
          },
        ],
      },
      { sheet, subject: "maths", ids, clips: NO_CLIPS, teacher: "" },
    );
    const twin = extra.find((piece) => piece.kind === "twin_problem")!;
    expect(twin.body.type === "number" && twin.body.answer).toBe(2.25);
    const which = extra.find((piece) => piece.kind === "which_formula")!;
    expect(which.body.type).toBe("choice");
    if (which.body.type !== "choice") return;
    expect(which.body.options[which.body.answer]!.text).toBe("z-score");
    expect(which.body.options[which.body.answer]!.sub).toBe("z = (x − μ) / σ");
  });

  it("turns a problem with a number answer into one to type", () => {
    const problem = lessonDrafts(inputOf(sheet, "maths")).find(
      (draft) => draft.kind === "problem",
    )!;
    expect(problem.body.type).toBe("number");
    expect(problem.body.type === "number" && problem.body.answer).toBe(2);
  });
});

describe("review results", () => {
  const base = {
    version: 1 as const,
    cards: {
      也: {
        due: "2026-12-10T10:00:00Z",
        intervalDays: 13,
        ease: 2.5,
        reps: 4,
        lapses: 0,
        lastReviewedAt: "2026-11-27T10:00:00Z",
      },
    },
  };
  const run: ReviewRun = {
    id: "run-1",
    startedAt: "2026-11-28T08:07:00Z",
    endedAt: "2026-11-28T08:12:00Z",
    length: 5,
    device: "phone",
    planHash: "abc",
    results: [
      {
        pieceId: "p1",
        kind: "quick_fire",
        outcome: "shaky",
        cardId: null,
        markId: null,
        cards: [
          { cardId: "面条", knew: false },
          { cardId: "也", knew: true },
        ],
      },
      {
        pieceId: "p2",
        kind: "explain_it",
        outcome: "missed",
        cardId: "term:Anomie",
        markId: null,
      },
    ],
  };

  it("brings missed cards back and leaves known ones that weren't due", () => {
    const after = applyReviewRun(base, run);
    expect(after.cards["面条"]!.due).toBe("2026-11-28T08:13:00.000Z");
    expect(after.cards["也"]).toEqual(base.cards["也"]);
    expect(after.cards["term:Anomie"]!.reps).toBe(0);
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews![0]).toMatchObject({
      device: "phone",
      right: 0,
      total: 2,
    });
  });

  it("counts a run sent twice only once", () => {
    const once = applyReviewRun(base, run);
    expect(applyReviewRun(once, run)).toBe(once);
  });

  it("judges quick-fire by the share of cards known", () => {
    expect(
      cardsOutcome([
        { knew: true },
        { knew: true },
        { knew: true },
        { knew: true },
        { knew: false },
      ]),
    ).toBe("knew");
    expect(cardsOutcome([{ knew: true }, { knew: false }])).toBe("shaky");
    expect(
      cardsOutcome([{ knew: false }, { knew: false }, { knew: true }]),
    ).toBe("missed");
  });

  it("lists what goes back into Practise", () => {
    const plan = assemblePlan({
      subject: "language",
      learning: "zh",
      explainIn: "en",
      drafts: lessonDrafts(inputOf(LANGUAGE_SHEET, "language")),
    });
    const quick = plan.pieces.find((piece) => piece.kind === "quick_fire")!;
    expect(
      intoPractice(plan.pieces, [
        {
          pieceId: quick.id,
          kind: "quick_fire",
          outcome: "shaky",
          cardId: null,
          markId: null,
          cards: [{ cardId: "面条", knew: false }],
        },
      ]),
    ).toEqual(["面条"]);
  });
});
