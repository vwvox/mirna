import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Play,
  X,
} from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { usePlayingClip } from "../clip-player";
import { Formula } from "../components/math";
import { LessonTerm } from "../components/term";
import { answerMatches } from "./arith";
import { cardsOutcome } from "./results";
import type {
  ReviewBody,
  ReviewClip,
  ReviewFace,
  ReviewOutcome,
  ReviewPiece,
  ReviewPieceKind,
} from "./types";

/** What the student has done in a piece so far. */
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

export const focus = {
  card: "rounded-[18px] border border-[#344E40] bg-[#21342A] p-5",
  answer: "rounded-[18px] border border-[#344E40] bg-[#284034] p-5",
  muted: "text-[#B5C2B9]",
  line: "border-[#4B6A58]",
  label: "text-xs font-semibold tracking-[0.06em] text-[#B5C2B9] uppercase",
  good: "border-[#9BD8AE] bg-[#1F4130]",
  bad: "border-[#F2A585] bg-[#4A2D22]",
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[11px] bg-[#E3B23C] px-4 text-sm font-semibold text-[#1C2B23] hover:bg-[#EBC25F] disabled:opacity-50",
  quiet:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[11px] border border-[#4B6A58] px-4 text-sm font-semibold text-[#F1EFE7] hover:bg-[#284034] disabled:opacity-50",
};

export function useKindLabels(): Record<ReviewPieceKind, string> {
  const { t } = useLingui();
  return {
    big_picture: t`The big picture`,
    explain_it: t`Explain it`,
    quick_fire: t`Quick-fire`,
    from_memory: t`From memory`,
    listen_pick: t`Listen`,
    replay_mark: t`Replay your mark`,
    fix_it: t`Fix it`,
    check_yourself: t`Check yourself`,
    spot_slip: t`Spot the slip`,
    contrast: t`Which one?`,
    sort_it: t`Sort it`,
    in_order: t`In order`,
    apply_it: t`Apply it`,
    which_formula: t`Which formula?`,
    twin_problem: t`Twin problem`,
    problem: t`Problem`,
  };
}

export function FaceView({
  face,
  size = "body",
}: {
  face: ReviewFace;
  size?: "hero" | "big" | "body";
}) {
  const textClass =
    size === "hero"
      ? "font-brand text-5xl leading-tight"
      : size === "big"
        ? "font-brand text-2xl leading-snug"
        : "text-base leading-relaxed";
  let content: ReactNode;
  if (face.latex) {
    content = (
      <Formula
        latex={face.latex}
        display
        label={face.text}
        className={size === "body" ? "text-xl" : "text-2xl"}
      />
    );
  } else if (face.learning) {
    content = (
      <LessonTerm
        term={face.text}
        reading={face.reading}
        className={cn([
          textClass,
          face.struck && "line-through decoration-[#F2A585]",
        ])}
      />
    );
  } else {
    content = (
      <span
        className={cn([
          textClass,
          face.struck && "line-through decoration-[#F2A585]",
        ])}
      >
        {face.text}
      </span>
    );
  }
  return (
    <div
      className={cn(["flex flex-col gap-1", face.struck && "text-[#F2A585]"])}
    >
      {content}
      {face.sub ? (
        <span className={cn(["text-sm", focus.muted])}>{face.sub}</span>
      ) : null}
    </div>
  );
}

export function ClipButton({
  clip,
  onPlay,
}: {
  clip: ReviewClip;
  onPlay: (clip: ReviewClip) => void;
}) {
  const playing = usePlayingClip((state) => state.id === clip.id);
  const minutes = Math.floor(clip.startMs / 60_000);
  const seconds = String(Math.floor((clip.startMs % 60_000) / 1000)).padStart(
    2,
    "0",
  );
  return (
    <button
      type="button"
      onClick={() => onPlay(clip)}
      className={cn([
        "inline-flex min-h-10 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1.5 text-sm font-semibold",
        focus.line,
        playing ? "bg-[#284034]" : "hover:bg-[#284034]",
      ])}
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-[#E3B23C] text-[#1C2B23]">
        <Play className="size-3" weight="bold" />
      </span>
      {clip.label}
      <span className={cn(["font-mono text-xs font-normal", focus.muted])}>
        {minutes}:{seconds}
      </span>
    </button>
  );
}

export function Clips({
  clips,
  onPlay,
}: {
  clips: ReviewClip[];
  onPlay: (clip: ReviewClip) => void;
}) {
  if (clips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {clips.map((clip) => (
        <ClipButton key={clip.id} clip={clip} onPlay={onPlay} />
      ))}
    </div>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn([
        "flex flex-1 flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed p-6 text-center text-sm",
        focus.line,
        focus.muted,
      ])}
    >
      <Eye className="size-5" />
      {children}
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      className={cn([
        "flex items-center gap-2 text-base font-bold",
        ok ? "text-[#9BD8AE]" : "text-[#F2A585]",
      ])}
    >
      {ok ? (
        <Check className="size-4" weight="bold" />
      ) : (
        <X className="size-4" weight="bold" />
      )}
      {children}
    </div>
  );
}

function GradeRow({ onGrade }: { onGrade: (outcome: ReviewOutcome) => void }) {
  const button =
    "flex min-h-12 items-center justify-center gap-2 rounded-[11px] border border-[#4B6A58] text-sm font-semibold hover:bg-[#21342A]";
  const key =
    "rounded border border-[#4B6A58] px-1.5 font-mono text-[11px] text-[#B5C2B9]";
  return (
    <div className="mt-auto grid grid-cols-3 gap-2" role="group">
      <button
        type="button"
        className={button}
        onClick={() => onGrade("missed")}
      >
        <span className={key}>1</span>
        <Trans>Missed it</Trans>
      </button>
      <button type="button" className={button} onClick={() => onGrade("shaky")}>
        <span className={key}>2</span>
        <Trans>Shaky</Trans>
      </button>
      <button type="button" className={button} onClick={() => onGrade("knew")}>
        <span className={key}>3</span>
        <Trans>Knew it</Trans>
      </button>
    </div>
  );
}

function NextRow({ onNext, note }: { onNext: () => void; note?: ReactNode }) {
  return (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-3">
      {note ? (
        <span className={cn(["mr-auto text-sm", focus.muted])}>{note}</span>
      ) : null}
      <button type="button" className={focus.primary} onClick={onNext}>
        <Trans>Next</Trans>
        <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

/** How a Mirna-checked piece went, from what the student did. */
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

export function PieceView({
  piece,
  state,
  update,
  onGrade,
  onNext,
  onPlay,
}: {
  piece: ReviewPiece;
  state: PieceState;
  update: (next: Partial<PieceState>) => void;
  /** A self-judged piece (or a whole quick-fire round) is done. */
  onGrade: (
    outcome: ReviewOutcome,
    cards?: { cardId: string; knew: boolean }[],
  ) => void;
  onNext: () => void;
  onPlay: (clip: ReviewClip) => void;
}) {
  const { t } = useLingui();
  const { body } = piece;

  if (body.type === "reveal") {
    return (
      <Panes
        left={
          <>
            {body.front ? <FaceView face={body.front} size="hero" /> : null}
            <label className={cn(["flex flex-col gap-1.5", focus.label])}>
              <Trans>Your answer, if you want to type it</Trans>
              <textarea
                className="min-h-24 resize-y rounded-xl border border-[#4B6A58] bg-[#18261F] p-3 text-base font-normal tracking-normal text-[#F1EFE7] normal-case"
                aria-label={t`Your answer`}
              />
            </label>
            {!state.revealed ? (
              <button
                type="button"
                className={cn([focus.primary, "self-start"])}
                onClick={() => update({ revealed: true })}
              >
                <Trans>Show the answer</Trans>
              </button>
            ) : null}
          </>
        }
        right={
          state.revealed ? (
            <>
              <div className="flex flex-col gap-3">
                {body.back.map((face, index) => (
                  <FaceView
                    key={index}
                    face={face}
                    size={index === 0 ? "big" : "body"}
                  />
                ))}
              </div>
              {piece.explain ? (
                <p className="text-sm">{piece.explain}</p>
              ) : null}
              <Clips clips={piece.clips} onPlay={onPlay} />
              <GradeRow onGrade={(outcome) => onGrade(outcome)} />
            </>
          ) : (
            <Waiting>
              <Trans>
                Answer first. The teacher's words and voice show here.
              </Trans>
            </Waiting>
          )
        }
      />
    );
  }

  if (body.type === "cards") {
    const item = body.items[Math.min(state.cardIndex, body.items.length - 1)]!;
    const answer = (knew: boolean) => {
      const cardResults = [
        ...state.cardResults,
        { cardId: item.cardId ?? item.front.text, knew },
      ];
      if (state.cardIndex + 1 >= body.items.length) {
        update({ cardResults });
        onGrade(cardsOutcome(cardResults), cardResults);
      } else {
        update({
          cardResults,
          cardIndex: state.cardIndex + 1,
          revealed: false,
        });
      }
    };
    return (
      <Panes
        left={
          <>
            <ol
              className="flex flex-wrap gap-1.5"
              aria-label={t`Cards in this round`}
            >
              {body.items.map((entry, index) => {
                const done = state.cardResults[index];
                return (
                  <li
                    key={index}
                    className={cn([
                      "rounded-full border px-2.5 py-0.5 text-sm",
                      done
                        ? done.knew
                          ? "border-[#9BD8AE] text-[#9BD8AE]"
                          : "border-[#F2A585] text-[#F2A585]"
                        : index === state.cardIndex
                          ? "border-[#E3B23C] bg-[#284034]"
                          : "border-[#4B6A58] text-[#B5C2B9]",
                    ])}
                  >
                    {entry.front.text}
                  </li>
                );
              })}
            </ol>
            <div className="flex min-h-48 flex-1 items-center justify-center rounded-2xl border border-[#344E40] bg-[#18261F] p-5">
              <FaceView face={item.front} size="hero" />
            </div>
            {!state.revealed ? (
              <button
                type="button"
                className={cn([focus.primary, "self-start"])}
                onClick={() => update({ revealed: true })}
              >
                <Trans>Turn it over</Trans>
              </button>
            ) : null}
          </>
        }
        right={
          state.revealed ? (
            <>
              <FaceView face={item.back} size="big" />
              {item.clip ? <Clips clips={[item.clip]} onPlay={onPlay} /> : null}
              <div className="mt-auto grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={focus.quiet}
                  onClick={() => answer(false)}
                >
                  <Trans>Missed it</Trans>
                </button>
                <button
                  type="button"
                  className={focus.quiet}
                  onClick={() => answer(true)}
                >
                  <Trans>Knew it</Trans>
                </button>
              </div>
            </>
          ) : (
            <Waiting>
              <Trans>Say it out loud or in your head, then turn it over.</Trans>
            </Waiting>
          )
        }
      />
    );
  }

  if (body.type === "choice") {
    const picked = state.pick !== null;
    return (
      <Panes
        left={
          <>
            {body.context ? (
              <div className="rounded-2xl border border-[#344E40] bg-[#18261F] p-4">
                <FaceView face={body.context} size="big" />
              </div>
            ) : null}
            {body.listen ? (
              <button
                type="button"
                className={cn([focus.primary, "self-start"])}
                onClick={() => onPlay(body.listen!)}
              >
                <Play className="size-4" weight="bold" />
                <Trans>Play it</Trans>
              </button>
            ) : null}
            <div className="flex flex-col gap-2" role="group">
              {body.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={picked}
                  onClick={() => update({ pick: index, revealed: true })}
                  className={cn([
                    "flex min-h-13 items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-base",
                    !picked && "border-[#4B6A58] hover:bg-[#284034]",
                    picked && index === body.answer && focus.good,
                    picked &&
                      index === state.pick &&
                      index !== body.answer &&
                      focus.bad,
                    picked &&
                      index !== body.answer &&
                      index !== state.pick &&
                      "border-[#4B6A58] opacity-55",
                  ])}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#4B6A58] font-mono text-xs text-[#B5C2B9]">
                    {index + 1}
                  </span>
                  <FaceView face={option} />
                </button>
              ))}
            </div>
          </>
        }
        right={
          picked ? (
            <>
              <Verdict ok={state.pick === body.answer}>
                {state.pick === body.answer ? (
                  <Trans>Right</Trans>
                ) : (
                  <Trans>Not quite</Trans>
                )}
              </Verdict>
              {body.reveal.map((face, index) => (
                <FaceView key={index} face={face} size="big" />
              ))}
              {piece.explain ? (
                <p className="text-base">{piece.explain}</p>
              ) : null}
              <Clips clips={piece.clips} onPlay={onPlay} />
              <NextRow
                onNext={onNext}
                note={<Trans>Mirna checked this one</Trans>}
              />
            </>
          ) : (
            <Waiting>
              <Trans>
                Pick one. The answer and the teacher's voice show here.
              </Trans>
            </Waiting>
          )
        }
      />
    );
  }

  if (body.type === "sort") {
    const done = Object.keys(state.placed).length === body.cards.length;
    const place = (card: number, group: number) =>
      update({ placed: { ...state.placed, [card]: group } });
    const unplace = (card: number) => {
      const placed = { ...state.placed };
      delete placed[card];
      update({ placed });
    };
    const wrong = body.cards
      .map((card, index) => ({ card, index }))
      .filter(
        ({ card, index }) =>
          state.placed[index] !== undefined &&
          state.placed[index] !== card.group,
      );
    return (
      <Panes
        left={
          <>
            <div className="flex flex-wrap gap-2">
              {body.cards.map((card, index) =>
                state.placed[index] === undefined ? (
                  <div
                    key={index}
                    className="inline-flex items-center gap-1 rounded-[10px] border border-dashed border-[#4B6A58] p-1 text-sm"
                  >
                    {body.groups.length === 2 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => place(index, 0)}
                          className="rounded-lg border border-[#4B6A58] p-2 hover:bg-[#284034]"
                          aria-label={t`${card.text}: ${body.groups[0]!.title}`}
                        >
                          <ArrowLeft className="size-3.5" />
                        </button>
                        <span className="px-1.5">{card.text}</span>
                        <button
                          type="button"
                          onClick={() => place(index, 1)}
                          className="rounded-lg border border-[#4B6A58] p-2 hover:bg-[#284034]"
                          aria-label={t`${card.text}: ${body.groups[1]!.title}`}
                        >
                          <ArrowRight className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="px-1.5">{card.text}</span>
                        {body.groups.map((group, groupIndex) => (
                          <button
                            key={groupIndex}
                            type="button"
                            onClick={() => place(index, groupIndex)}
                            className="rounded-lg border border-[#4B6A58] px-2 py-1.5 text-xs font-semibold hover:bg-[#284034]"
                            aria-label={t`${card.text}: ${group.title}`}
                          >
                            {group.title}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                ) : null,
              )}
            </div>
            <div
              className={cn([
                "grid gap-3",
                body.groups.length === 3 ? "grid-cols-3" : "grid-cols-2",
              ])}
            >
              {body.groups.map((group, groupIndex) => (
                <div
                  key={groupIndex}
                  className="flex min-h-32 flex-col gap-2 rounded-[14px] border border-dashed border-[#4B6A58] bg-[#18261F] p-3"
                  role="group"
                  aria-label={group.title}
                >
                  <div className="text-sm font-bold">{group.title}</div>
                  {body.cards.map((card, index) =>
                    state.placed[index] === groupIndex ? (
                      <div
                        key={index}
                        className={cn([
                          "flex min-h-11 items-center gap-2 rounded-[10px] border py-1 pr-1 pl-3 text-sm",
                          done
                            ? card.group === groupIndex
                              ? focus.good
                              : focus.bad
                            : "border-[#4B6A58] bg-[#284034]",
                        ])}
                      >
                        <span className="flex-1">{card.text}</span>
                        {!done ? (
                          <button
                            type="button"
                            onClick={() => unplace(index)}
                            className="rounded-md p-2 text-[#B5C2B9] hover:bg-[#21342A]"
                            aria-label={t`Take ${card.text} out`}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          </>
        }
        right={
          done ? (
            <>
              <Verdict ok={wrong.length === 0}>
                {wrong.length === 0 ? (
                  <Trans>All in the right place</Trans>
                ) : (
                  <Trans>
                    {body.cards.length - wrong.length} of {body.cards.length} in
                    the right place
                  </Trans>
                )}
              </Verdict>
              {wrong.map(({ card, index }) => (
                <div
                  key={index}
                  className="flex flex-col gap-1 rounded-xl border border-[#344E40] bg-[#18261F] p-3"
                >
                  <b className="text-sm">
                    {card.text}: {body.groups[card.group]?.title}
                  </b>
                  {card.why ? (
                    <p className={cn(["text-sm", focus.muted])}>{card.why}</p>
                  ) : null}
                </div>
              ))}
              {piece.explain ? (
                <p className="text-sm">{piece.explain}</p>
              ) : null}
              <Clips clips={piece.clips} onPlay={onPlay} />
              <NextRow
                onNext={onNext}
                note={<Trans>Mirna checked the groups</Trans>}
              />
            </>
          ) : (
            <Waiting>
              <Trans>
                Sort every card. Any in the wrong group come back with why.
              </Trans>
            </Waiting>
          )
        }
      />
    );
  }

  if (body.type === "order") {
    const done = state.chain.length === body.items.length;
    return (
      <Panes
        left={
          <>
            {body.context ? <FaceView face={body.context} size="big" /> : null}
            <ol className="flex flex-col gap-2">
              {state.chain.map((item, position) => (
                <li
                  key={item}
                  className={cn([
                    "flex min-h-11 items-center gap-2.5 rounded-[10px] border py-1 pr-1 pl-2.5 text-sm",
                    done
                      ? item === position
                        ? focus.good
                        : focus.bad
                      : "border-[#4B6A58] bg-[#284034]",
                  ])}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#E3B23C] text-xs font-bold text-[#1C2B23]">
                    {position + 1}
                  </span>
                  <span className="flex-1">{body.items[item]!.text}</span>
                  {!done ? (
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          chain: state.chain.filter((entry) => entry !== item),
                        })
                      }
                      className="rounded-md p-2 text-[#B5C2B9] hover:bg-[#21342A]"
                      aria-label={t`Take it out`}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-2">
              {body.shuffled
                .filter((item) => !state.chain.includes(item))
                .map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => update({ chain: [...state.chain, item] })}
                    className="min-h-11 rounded-[10px] border border-dashed border-[#4B6A58] px-3 py-2 text-left text-sm hover:bg-[#284034]"
                  >
                    {body.items[item]!.text}
                  </button>
                ))}
            </div>
            {state.chain.length === 0 ? (
              <p className={cn(["text-sm", focus.muted])}>
                <Trans>Tap them in the order they happen.</Trans>
              </p>
            ) : null}
          </>
        }
        right={
          done ? (
            <>
              <Verdict
                ok={state.chain.every((item, position) => item === position)}
              >
                {state.chain.every((item, position) => item === position) ? (
                  <Trans>Right order</Trans>
                ) : (
                  <Trans>Not quite. The order from class:</Trans>
                )}
              </Verdict>
              {!state.chain.every((item, position) => item === position) ? (
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
                  {body.items.map((item, index) => (
                    <li key={index}>{item.text}</li>
                  ))}
                </ol>
              ) : null}
              {piece.explain ? (
                <p className="text-sm">{piece.explain}</p>
              ) : null}
              <Clips clips={piece.clips} onPlay={onPlay} />
              <NextRow
                onNext={onNext}
                note={<Trans>Mirna checked the order</Trans>}
              />
            </>
          ) : (
            <Waiting>
              <Trans>
                Put all of them in order. The order from class shows here.
              </Trans>
            </Waiting>
          )
        }
      />
    );
  }

  // A number to work out.
  const right = answerMatches(state.typed, body.answer);
  return (
    <Panes
      left={
        <>
          {body.context ? <FaceView face={body.context} size="big" /> : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2.5 text-base">
              <Trans>Your answer</Trans>
              <input
                className="h-11 w-32 rounded-[10px] border border-[#4B6A58] bg-[#18261F] px-3 font-mono text-lg text-[#F1EFE7]"
                value={state.typed}
                onChange={(event) => update({ typed: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && state.typed.trim())
                    update({ revealed: true });
                }}
                disabled={state.revealed}
                inputMode="decimal"
              />
            </label>
            {!state.revealed ? (
              <button
                type="button"
                className={focus.primary}
                disabled={!state.typed.trim()}
                onClick={() => update({ revealed: true })}
              >
                <Trans>Check</Trans>
              </button>
            ) : null}
          </div>
          {body.steps.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className={focus.label}>
                <Trans>Stuck? One step at a time</Trans>
              </span>
              <ol className="flex flex-col gap-2">
                {body.steps.map((step, index) => (
                  <li key={index} className="flex items-center gap-2.5 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[#4B6A58] text-xs font-bold text-[#B5C2B9]">
                      {index + 1}
                    </span>
                    {index < state.steps || state.revealed ? (
                      step.text
                    ) : (
                      <span className={focus.muted}>
                        <Trans>Hidden</Trans>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {state.steps < body.steps.length && !state.revealed ? (
                <button
                  type="button"
                  className={cn([focus.quiet, "self-start"])}
                  onClick={() => update({ steps: state.steps + 1 })}
                >
                  <Trans>Show the next step</Trans>
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      }
      right={
        state.revealed ? (
          <>
            <Verdict ok={right}>
              {right ? (
                body.answerText
              ) : (
                <Trans>Not quite: {body.answerText}</Trans>
              )}
            </Verdict>
            {piece.explain ? (
              <p className="text-base">{piece.explain}</p>
            ) : null}
            {piece.written ? (
              <p className={cn(["text-sm", focus.muted])}>
                <Trans>The AI wrote the sum; Mirna worked it out.</Trans>
              </p>
            ) : null}
            <Clips clips={piece.clips} onPlay={onPlay} />
            <NextRow
              onNext={onNext}
              note={<Trans>Mirna checked your answer</Trans>}
            />
          </>
        ) : (
          <Waiting>
            <Trans>Type your answer and check it.</Trans>
          </Waiting>
        )
      }
    />
  );
}

function Panes({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <section className={cn([focus.card, "flex min-w-0 flex-col gap-4"])}>
        <p className={focus.label}>
          <Trans>Your turn</Trans>
        </p>
        {left}
      </section>
      <section
        className={cn([focus.answer, "flex min-w-0 flex-col gap-4"])}
        aria-live="polite"
      >
        {right}
      </section>
    </div>
  );
}
