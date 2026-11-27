import type { LessonSubject } from "../types";
import type { ReviewDraft } from "./drafts";
import {
  PIECE_SECONDS,
  type ReviewPiece,
  type ReviewPieceKind,
  type ReviewPlan,
  WRAP_UP_SECONDS,
} from "./types";

type Playbook = {
  /** The order pieces are played in. */
  order: ReviewPieceKind[];
  /** What the 5-minute review takes first, round by round. */
  core: ReviewPieceKind[];
  /** What the 10-minute review adds, round by round. */
  extra: ReviewPieceKind[];
};

/**
 * One mindset per kind of class. Language: hear it, say it, fix it, use it.
 * Topic: explain it, connect it, apply it. Maths & science: recognise it,
 * recall it, run it. Slips and marked moments come early.
 */
export const PLAYBOOKS: Record<LessonSubject, Playbook> = {
  language: {
    order: [
      "listen_pick",
      "fix_it",
      "replay_mark",
      "contrast",
      "explain_it",
      "quick_fire",
      "sort_it",
    ],
    core: ["fix_it", "listen_pick", "quick_fire", "contrast", "replay_mark"],
    extra: ["replay_mark", "explain_it", "sort_it", "fix_it", "listen_pick"],
  },
  topic: {
    order: [
      "big_picture",
      "explain_it",
      "replay_mark",
      "sort_it",
      "contrast",
      "apply_it",
      "in_order",
      "fix_it",
      "check_yourself",
      "quick_fire",
    ],
    core: [
      "big_picture",
      "explain_it",
      "sort_it",
      "apply_it",
      "replay_mark",
      "check_yourself",
      "quick_fire",
    ],
    extra: [
      "explain_it",
      "replay_mark",
      "contrast",
      "in_order",
      "check_yourself",
      "fix_it",
      "quick_fire",
    ],
  },
  maths: {
    order: [
      "which_formula",
      "from_memory",
      "replay_mark",
      "spot_slip",
      "fix_it",
      "in_order",
      "problem",
      "twin_problem",
      "check_yourself",
      "explain_it",
    ],
    core: [
      "which_formula",
      "from_memory",
      "spot_slip",
      "twin_problem",
      "fix_it",
      "problem",
      "check_yourself",
    ],
    extra: [
      "from_memory",
      "replay_mark",
      "in_order",
      "problem",
      "check_yourself",
      "fix_it",
      "explain_it",
    ],
  },
};

const CORE_SECONDS = 5 * 60 - WRAP_UP_SECONDS;
const ALL_SECONDS = 10 * 60 - WRAP_UP_SECONDS;

export function draftSeconds(draft: ReviewDraft): number {
  if (draft.body.type === "cards") {
    return (
      PIECE_SECONDS.quick_fire + Math.max(0, draft.body.items.length - 6) * 7
    );
  }
  return PIECE_SECONDS[draft.kind];
}

/**
 * Picks pieces for a 5- and a 10-minute review from what the lesson offers
 * (and what the AI wrote), and puts them in the mindset's order. Pieces of
 * one kind keep the order they were given in: the most needed first.
 */
export function assemblePlan({
  subject,
  learning,
  explainIn,
  drafts,
}: {
  subject: LessonSubject;
  learning: string;
  explainIn: string;
  drafts: ReviewDraft[];
}): ReviewPlan {
  const playbook = PLAYBOOKS[subject];
  const queues = new Map<ReviewPieceKind, ReviewDraft[]>();
  // Written pieces go before the lesson's own of the same kind: they exist
  // because the lesson had something worth turning into a new question.
  const ordered = [
    ...drafts.filter((draft) => draft.written),
    ...drafts.filter((draft) => !draft.written),
  ];
  for (const draft of ordered) {
    const queue = queues.get(draft.kind) ?? [];
    queue.push(draft);
    queues.set(draft.kind, queue);
  }

  const chosen: { draft: ReviewDraft; core: boolean; seconds: number }[] = [];
  let used = 0;
  function fill(kinds: ReviewPieceKind[], budget: number, core: boolean) {
    let added = true;
    while (added) {
      added = false;
      for (const kind of kinds) {
        const queue = queues.get(kind);
        const next = queue?.[0];
        if (!next) continue;
        const seconds = draftSeconds(next);
        if (used + seconds > budget) continue;
        queue!.shift();
        chosen.push({ draft: next, core, seconds });
        used += seconds;
        added = true;
      }
    }
  }
  fill(playbook.core, CORE_SECONDS, true);
  fill([...playbook.extra, ...playbook.core], ALL_SECONDS, false);

  const rank = (kind: ReviewPieceKind) => {
    const index = playbook.order.indexOf(kind);
    return index === -1 ? playbook.order.length : index;
  };
  const sorted = chosen
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) => rank(a.draft.kind) - rank(b.draft.kind) || a.index - b.index,
    );
  spreadKinds(sorted);

  const pieces: ReviewPiece[] = sorted.map((entry, index) => ({
    ...entry.draft,
    id: `p${index + 1}`,
    core: entry.core,
    seconds: entry.seconds,
  }));
  return {
    version: 1,
    mindset: subject,
    learning,
    explainIn,
    pieces,
    withAi: pieces.some((piece) => piece.written),
  };
}

/** Never two pieces of the same kind in a row, when there is something else to put between them. */
function spreadKinds<T extends { draft: ReviewDraft }>(items: T[]) {
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1]!.draft.kind;
    if (items[index]!.draft.kind !== previous) continue;
    const swap = items.findIndex(
      (item, other) => other > index && item.draft.kind !== previous,
    );
    if (swap === -1) return;
    const [moved] = items.splice(swap, 1);
    items.splice(index, 0, moved!);
  }
}
