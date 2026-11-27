import { updateLessonDocument } from "../documents";
import { type PracticeGrade, scheduleCard } from "../practice";
import { emptyLessonPractice, parseLessonPractice } from "../schema";
import type { LessonPracticeDocument, LessonReviewRecord } from "../types";
import type {
  ReviewOutcome,
  ReviewPiece,
  ReviewResult,
  ReviewRun,
} from "./types";

const KEEP_REVIEWS = 50;

export function gradeOf(outcome: ReviewOutcome): PracticeGrade {
  return outcome === "knew" ? "good" : outcome === "shaky" ? "hard" : "again";
}

/** Quick-fire: most cards known is known, about half is shaky. */
export function cardsOutcome(cards: { knew: boolean }[]): ReviewOutcome {
  if (cards.length === 0) return "shaky";
  const share = cards.filter((card) => card.knew).length / cards.length;
  return share >= 0.8 ? "knew" : share >= 0.5 ? "shaky" : "missed";
}

export function runScore(results: ReviewResult[]): {
  right: number;
  total: number;
} {
  return {
    right: results.filter((result) => result.outcome === "knew").length,
    total: results.length,
  };
}

/**
 * A review's results laid onto the lesson's practice: a missed or shaky piece
 * brings its card back soon; a known one only moves a card that was due
 * anyway, so a review never pushes a card further than Practise would. A run
 * already counted (sent twice from the phone) changes nothing.
 */
export function applyReviewRun(
  current: LessonPracticeDocument,
  run: ReviewRun,
): LessonPracticeDocument {
  if (current.reviews?.some((review) => review.id === run.id)) return current;
  const now = new Date(run.endedAt);
  const at = Number.isNaN(now.getTime()) ? new Date() : now;
  const cards = { ...current.cards };
  const grade = (cardId: string, outcome: ReviewOutcome) => {
    const state = cards[cardId];
    const due = !state || new Date(state.due).getTime() <= at.getTime();
    if (outcome === "knew" && !due) return;
    cards[cardId] = scheduleCard(state, gradeOf(outcome), at);
  };
  for (const result of run.results) {
    if (result.cards?.length) {
      for (const card of result.cards) {
        grade(card.cardId, card.knew ? "knew" : "missed");
      }
    } else if (result.cardId) {
      grade(result.cardId, result.outcome);
    }
  }
  const { right, total } = runScore(run.results);
  const record: LessonReviewRecord = {
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    length: run.length,
    device: run.device,
    right,
    total,
    results: run.results.map((result) => ({
      pieceId: result.pieceId,
      kind: result.kind,
      outcome: result.outcome,
    })),
  };
  const reviews = [...(current.reviews ?? []), record]
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
    .slice(-KEEP_REVIEWS);
  return { ...current, cards, reviews };
}

export function recordReviewRun(
  sessionId: string,
  run: ReviewRun,
): Promise<LessonPracticeDocument> {
  return updateLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
    emptyLessonPractice,
    (current) => applyReviewRun(current, run),
  );
}

/** What goes back into Practise after a review, for the wrap-up. */
export function intoPractice(
  pieces: ReviewPiece[],
  results: ReviewResult[],
): string[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const lines: string[] = [];
  for (const result of results) {
    const piece = byId.get(result.pieceId);
    if (!piece) continue;
    if (piece.body.type === "cards" && result.cards) {
      for (const card of result.cards) {
        if (card.knew) continue;
        const item = piece.body.items.find(
          (entry) => entry.cardId === card.cardId,
        );
        if (item) lines.push(item.front.text);
      }
    } else if (result.cardId && result.outcome !== "knew") {
      const front =
        piece.body.type === "reveal" ? piece.body.front?.text : undefined;
      lines.push(front || piece.prompt);
    }
  }
  return [...new Set(lines)];
}
