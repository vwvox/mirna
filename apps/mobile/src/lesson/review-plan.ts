// The review plan as the Mac makes it (the wire format). The Mac's
// apps/desktop/src/lesson/review/types.ts is the source; keep this in step.
// The phone never makes or changes a plan: it plays the Mac's.

export type ReviewOutcome = "missed" | "shaky" | "knew";
export type ReviewLength = 5 | 10;

export type ReviewPieceKind =
  | "big_picture"
  | "explain_it"
  | "quick_fire"
  | "from_memory"
  | "listen_pick"
  | "replay_mark"
  | "fix_it"
  | "check_yourself"
  | "spot_slip"
  | "contrast"
  | "sort_it"
  | "in_order"
  | "apply_it"
  | "which_formula"
  | "twin_problem"
  | "problem";

export const WRAP_UP_SECONDS = 30;

export type ReviewClip = {
  id: string;
  startMs: number;
  endMs: number;
  channel: 0 | 1 | null;
  label: string;
};

export type ReviewFace = {
  text: string;
  reading?: string;
  latex?: string;
  sub?: string;
  learning?: boolean;
  struck?: boolean;
};

export type ReviewBody =
  | { type: "reveal"; front: ReviewFace | null; back: ReviewFace[] }
  | {
      type: "cards";
      items: {
        front: ReviewFace;
        back: ReviewFace;
        clip: ReviewClip | null;
        cardId: string | null;
      }[];
    }
  | {
      type: "choice";
      context: ReviewFace | null;
      listen: ReviewClip | null;
      options: ReviewFace[];
      answer: number;
      reveal: ReviewFace[];
    }
  | {
      type: "sort";
      groups: { title: string; hint: string }[];
      cards: { text: string; group: number; why: string }[];
    }
  | {
      type: "order";
      context: ReviewFace | null;
      items: ReviewFace[];
      shuffled: number[];
    }
  | {
      type: "number";
      context: ReviewFace | null;
      steps: ReviewFace[];
      answer: number;
      answerText: string;
    };

export type ReviewPiece = {
  id: string;
  kind: ReviewPieceKind;
  core: boolean;
  seconds: number;
  written: boolean;
  source: string;
  prompt: string;
  body: ReviewBody;
  explain: string;
  clips: ReviewClip[];
  cardId: string | null;
  markId: string | null;
};

export type ReviewPlan = {
  version: 1;
  mindset: "language" | "topic" | "maths";
  learning: string;
  explainIn: string;
  pieces: ReviewPiece[];
  withAi: boolean;
};

export type ReviewPlanDocument = {
  plan: ReviewPlan;
  generatedAt: string;
  model: string | null;
  sourceHash: string;
};

export type ReviewResult = {
  pieceId: string;
  kind: ReviewPieceKind;
  outcome: ReviewOutcome;
  cardId: string | null;
  markId: string | null;
  cards?: { cardId: string; knew: boolean }[];
};

export type ReviewRun = {
  id: string;
  startedAt: string;
  endedAt: string;
  length: ReviewLength;
  device: "mac" | "phone";
  planHash: string;
  results: ReviewResult[];
};

const BODY_TYPES = new Set([
  "reveal",
  "cards",
  "choice",
  "sort",
  "order",
  "number",
]);

/** A plan from a newer Mac with pieces this phone can't play keeps the rest. */
export function parseReviewPlanDocument(
  json: string | null | undefined,
): ReviewPlanDocument | null {
  if (!json) return null;
  try {
    const document = JSON.parse(json) as Partial<ReviewPlanDocument>;
    const plan = document.plan;
    if (!plan || plan.version !== 1 || !Array.isArray(plan.pieces)) return null;
    return {
      plan: {
        ...plan,
        pieces: plan.pieces.filter(
          (piece) => piece && BODY_TYPES.has(piece.body?.type),
        ),
      },
      generatedAt: String(document.generatedAt ?? ""),
      model: typeof document.model === "string" ? document.model : null,
      sourceHash: String(document.sourceHash ?? ""),
    };
  } catch {
    return null;
  }
}

export function piecesFor(
  plan: ReviewPlan,
  length: ReviewLength,
): ReviewPiece[] {
  return length === 10
    ? plan.pieces
    : plan.pieces.filter((piece) => piece.core);
}

export function cardsOutcome(cards: { knew: boolean }[]): ReviewOutcome {
  if (cards.length === 0) return "shaky";
  const share = cards.filter((card) => card.knew).length / cards.length;
  return share >= 0.8 ? "knew" : share >= 0.5 ? "shaky" : "missed";
}

/** Whether a typed number matches, allowing for rounding (as on the Mac). */
export function answerMatches(typed: string, answer: number): boolean {
  const value = Number(
    typed
      .trim()
      .replace(",", ".")
      .replace(/[−–]/g, "-"),
  );
  if (!typed.trim() || !Number.isFinite(value)) return false;
  return Math.abs(value - answer) <= Math.max(0.005, Math.abs(answer) * 0.005);
}

export const KIND_LABELS: Record<ReviewPieceKind, string> = {
  big_picture: "The big picture",
  explain_it: "Explain it",
  quick_fire: "Quick-fire",
  from_memory: "From memory",
  listen_pick: "Listen",
  replay_mark: "Replay your mark",
  fix_it: "Fix it",
  check_yourself: "Check yourself",
  spot_slip: "Spot the slip",
  contrast: "Which one?",
  sort_it: "Sort it",
  in_order: "In order",
  apply_it: "Apply it",
  which_formula: "Which formula?",
  twin_problem: "Twin problem",
  problem: "Problem",
};

/** Every clip a plan plays, once each. */
export function planClips(plan: ReviewPlan): ReviewClip[] {
  const seen = new Map<string, ReviewClip>();
  for (const piece of plan.pieces) {
    for (const clip of piece.clips) seen.set(clip.id, clip);
    if (piece.body.type === "choice" && piece.body.listen) {
      seen.set(piece.body.listen.id, piece.body.listen);
    }
    if (piece.body.type === "cards") {
      for (const item of piece.body.items) {
        if (item.clip) seen.set(item.clip.id, item.clip);
      }
    }
  }
  return [...seen.values()];
}

export function runScore(results: ReviewResult[]) {
  return {
    right: results.filter((result) => result.outcome === "knew").length,
    total: results.length,
  };
}

/** What goes back into Practise on the Mac after this run, for the wrap-up. */
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
      lines.push(
        (piece.body.type === "reveal" ? piece.body.front?.text : undefined) ||
          piece.prompt,
      );
    }
  }
  return [...new Set(lines)];
}

/** Where someone is in a piece while they play it. */
export type PieceState = {
  /** The answer is showing (or the card is turned). */
  revealed: boolean;
  pick: number | null;
  cardIndex: number;
  cardResults: { cardId: string; knew: boolean }[];
  placed: Record<number, number>;
  chain: number[];
  typed: string;
  steps: number;
};

export const FRESH_STATE: PieceState = {
  revealed: false,
  pick: null,
  cardIndex: 0,
  cardResults: [],
  placed: {},
  chain: [],
  typed: "",
  steps: 0,
};

/**
 * The outcome of a piece Mirna checks (a choice, a sort, an order, a sum)
 * once it's answered, as on the Mac; null while it isn't, or for pieces the
 * student judges.
 */
export function checkedOutcome(
  body: ReviewBody,
  state: PieceState,
): ReviewOutcome | null {
  switch (body.type) {
    case "choice":
      return state.pick === null
        ? null
        : state.pick === body.answer
          ? "knew"
          : "missed";
    case "sort": {
      if (Object.keys(state.placed).length < body.cards.length) return null;
      const right = body.cards.filter(
        (card, index) => state.placed[index] === card.group,
      ).length;
      const share = right / body.cards.length;
      return share === 1 ? "knew" : share >= 0.66 ? "shaky" : "missed";
    }
    case "order": {
      if (state.chain.length < body.items.length) return null;
      const right = state.chain.filter((item, index) => item === index).length;
      const share = right / body.items.length;
      return share === 1 ? "knew" : share >= 0.6 ? "shaky" : "missed";
    }
    case "number":
      if (!state.revealed) return null;
      if (!answerMatches(state.typed, body.answer)) return "missed";
      return state.steps > 0 ? "shaky" : "knew";
    default:
      return null;
  }
}
