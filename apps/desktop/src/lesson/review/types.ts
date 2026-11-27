import type { LessonSubject } from "../types";

/**
 * A review is a short session made from a lesson: pieces from a fixed
 * library, each asking before it shows, played in order. The Mac makes the
 * plan once and keeps it with the lesson (`lesson_review`); the phone gets the
 * same plan and only plays it. Keep `apps/mobile/src/lesson/review-plan.ts` in
 * step with this file: it is the wire format.
 */

/** How a piece went: the student's own call, or Mirna's check. */
export type ReviewOutcome = "missed" | "shaky" | "knew";

export const REVIEW_PIECE_KINDS = [
  "big_picture",
  "explain_it",
  "quick_fire",
  "from_memory",
  "listen_pick",
  "replay_mark",
  "fix_it",
  "check_yourself",
  "spot_slip",
  "contrast",
  "sort_it",
  "in_order",
  "apply_it",
  "which_formula",
  "twin_problem",
  "problem",
] as const;
export type ReviewPieceKind = (typeof REVIEW_PIECE_KINDS)[number];

/** About how long each piece takes, reading and answering included. */
export const PIECE_SECONDS: Record<ReviewPieceKind, number> = {
  big_picture: 40,
  explain_it: 45,
  quick_fire: 50,
  from_memory: 50,
  listen_pick: 40,
  replay_mark: 75,
  fix_it: 45,
  check_yourself: 45,
  spot_slip: 55,
  contrast: 40,
  sort_it: 55,
  in_order: 55,
  apply_it: 55,
  which_formula: 45,
  twin_problem: 80,
  problem: 70,
};

/** The wrap-up both players add at the end. */
export const WRAP_UP_SECONDS = 30;

export type ReviewLength = 5 | 10;

/** A stretch of the lesson's recording, played with an answer. */
export type ReviewClip = {
  /** The same stretch always has the same id, so the phone fetches it once. */
  id: string;
  startMs: number;
  endMs: number;
  /** The side of a call recorded on the Mac: 0 the mic, 1 the call; null both. */
  channel: 0 | 1 | null;
  /** Who is speaking, or what the moment is: "Lǎoshī Chen", "You". */
  label: string;
};

/** One thing shown: a word, a sentence, a definition, a formula. */
export type ReviewFace = {
  text: string;
  /** Pinyin, kana or a transliteration of `text`. */
  reading?: string;
  /** A formula as LaTeX, drawn with KaTeX on the Mac; `text` is a plain version. */
  latex?: string;
  /** A smaller line under it: a translation, a note, a time. */
  sub?: string;
  /** Written in the language being learnt (fonts, `lang`, readings). */
  learning?: boolean;
  /** What the student said wrong, shown struck through. */
  struck?: boolean;
};

export type ReviewCardItem = {
  front: ReviewFace;
  back: ReviewFace;
  clip: ReviewClip | null;
  cardId: string | null;
};

export type ReviewSortCard = {
  text: string;
  group: number;
  /** Why it belongs there, shown when it was put in the wrong group. */
  why: string;
};

/** What the student does in a piece. Mirna checks all but `reveal` and `cards`. */
export type ReviewBody =
  /** Think or say the answer, then see it, then say how it went. */
  | { type: "reveal"; front: ReviewFace | null; back: ReviewFace[] }
  /** A few flash cards in a row, each turned over and judged. */
  | { type: "cards"; items: ReviewCardItem[] }
  /** Pick one. `listen` plays first when the question is about a clip. */
  | {
      type: "choice";
      context: ReviewFace | null;
      listen: ReviewClip | null;
      options: ReviewFace[];
      answer: number;
      /** Shown once answered: the sentence heard, the worked line. */
      reveal: ReviewFace[];
    }
  /** Put each card in its group. */
  | {
      type: "sort";
      groups: { title: string; hint: string }[];
      cards: ReviewSortCard[];
    }
  /** Put the items in order; `shuffled` is the order they are shown in. */
  | {
      type: "order";
      context: ReviewFace | null;
      items: ReviewFace[];
      shuffled: number[];
    }
  /** Work out a number; steps can be shown one at a time. */
  | {
      type: "number";
      context: ReviewFace | null;
      steps: ReviewFace[];
      answer: number;
      /** The answer as it is shown, already rounded. */
      answerText: string;
    };

export type ReviewPiece = {
  /** Unique within its plan. */
  id: string;
  kind: ReviewPieceKind;
  /** Played in the 5-minute review too; the 10-minute one plays every piece. */
  core: boolean;
  seconds: number;
  /** Made up by the AI for this review, which the player says. */
  written: boolean;
  /** Where it comes from, for the chip: "Your slip at 31:02". */
  source: string;
  /** The question, as the heading. */
  prompt: string;
  body: ReviewBody;
  /** Shown with the answer: why, the rule, the teacher's point. */
  explain: string;
  /** The teacher (or the student) at that moment, played with the answer. */
  clips: ReviewClip[];
  /** The practice card this piece tests. */
  cardId: string | null;
  /** The mark this piece answers. */
  markId: string | null;
};

export type ReviewPlan = {
  version: 1;
  mindset: LessonSubject;
  /** Language codes, as in the lesson's settings. */
  learning: string;
  explainIn: string;
  /** In play order. */
  pieces: ReviewPiece[];
  /** Some pieces were written by the AI. */
  withAi: boolean;
};

export type ReviewPlanDocument = {
  plan: ReviewPlan;
  generatedAt: string;
  /** The AI that wrote pieces for it, or null for a plan made without one. */
  model: string | null;
  sourceHash: string;
};

export type ReviewResult = {
  pieceId: string;
  kind: ReviewPieceKind;
  outcome: ReviewOutcome;
  cardId: string | null;
  markId: string | null;
  /** Quick-fire: how each card went. */
  cards?: { cardId: string; knew: boolean }[];
};

/** One review played, on the Mac or on the phone. */
export type ReviewRun = {
  /** Made where it was played; a run sent twice counts once. */
  id: string;
  startedAt: string;
  endedAt: string;
  length: ReviewLength;
  device: "mac" | "phone";
  /** The `sourceHash` of the plan it was played from. */
  planHash: string;
  results: ReviewResult[];
};

/** The pieces to play for a length, in order. */
export function piecesFor(
  plan: ReviewPlan,
  length: ReviewLength,
): ReviewPiece[] {
  return length === 10
    ? plan.pieces
    : plan.pieces.filter((piece) => piece.core);
}

export function reviewSeconds(pieces: ReviewPiece[]): number {
  return (
    pieces.reduce((total, piece) => total + piece.seconds, 0) + WRAP_UP_SECONDS
  );
}
