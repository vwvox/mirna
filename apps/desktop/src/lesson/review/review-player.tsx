import { Trans, useLingui } from "@lingui/react/macro";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ArrowsInSimple, ArrowsOutSimple, X } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { playSessionClip, stopClip } from "../clip-player";
import { LessonLanguageProvider } from "../language-context";
import { intoPractice, recordReviewRun, runScore } from "./results";
import {
  checkedOutcome,
  FRESH_STATE,
  focus,
  type PieceState,
  PieceView,
  useKindLabels,
} from "./review-pieces";
import {
  piecesFor,
  type ReviewClip,
  type ReviewLength,
  type ReviewOutcome,
  type ReviewPlanDocument,
  type ReviewResult,
  type ReviewRun,
  WRAP_UP_SECONDS,
} from "./types";

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(Math.abs(seconds)));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * A review, full window: one piece at a time, the student's turn on the left
 * and the teacher's answer on the right. The run is saved into the lesson's
 * practice at the wrap-up, or when stopped after a few pieces.
 */
export function ReviewPlayer({
  sessionId,
  title,
  document,
  length,
  onClose,
  onLength,
}: {
  sessionId: string;
  title: string;
  document: ReviewPlanDocument;
  length: ReviewLength;
  onClose: () => void;
  /** Play the other length, from the start. */
  onLength: (length: ReviewLength) => void;
}) {
  const { t } = useLingui();
  const kindLabels = useKindLabels();
  const plan = document.plan;
  const pieces = useMemo(() => piecesFor(plan, length), [plan, length]);
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, PieceState>>({});
  const [results, setResults] = useState<Record<string, ReviewResult>>({});
  const startedAt = useRef(new Date());
  const saved = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const wrapUp = index >= pieces.length;
  const piece = wrapUp ? null : pieces[index]!;
  const state = (piece && states[piece.id]) || FRESH_STATE;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const ordered = useCallback(
    () =>
      pieces
        .map((entry) => results[entry.id])
        .filter((result): result is ReviewResult => Boolean(result)),
    [pieces, results],
  );

  const save = useCallback(() => {
    const done = ordered();
    if (saved.current || done.length === 0) return;
    saved.current = true;
    const run: ReviewRun = {
      id: crypto.randomUUID(),
      startedAt: startedAt.current.toISOString(),
      endedAt: new Date().toISOString(),
      length,
      device: "mac",
      planHash: document.sourceHash,
      results: done,
    };
    void recordReviewRun(sessionId, run).catch((error: unknown) => {
      console.error("[lesson] could not save the review", error);
    });
  }, [document.sourceHash, length, ordered, sessionId]);

  useEffect(() => {
    if (wrapUp) save();
  }, [save, wrapUp]);

  const close = useCallback(() => {
    stopClip();
    // Stopped part-way: what was answered still counts.
    if (ordered().length >= 2) save();
    if (fullscreen) void getCurrentWindow().setFullscreen(false);
    onClose();
  }, [fullscreen, onClose, ordered, save]);

  const play = useCallback(
    (clip: ReviewClip) => {
      void playSessionClip(
        sessionId,
        { startMs: clip.startMs, endMs: clip.endMs, channel: clip.channel },
        1,
        clip.id,
      );
    },
    [sessionId],
  );

  const go = useCallback(
    (next: number) => {
      stopClip();
      setIndex(Math.max(0, Math.min(pieces.length, next)));
    },
    [pieces.length],
  );

  const record = useCallback(
    (outcome: ReviewOutcome, cards?: { cardId: string; knew: boolean }[]) => {
      if (!piece) return;
      setResults((current) => ({
        ...current,
        [piece.id]: {
          pieceId: piece.id,
          kind: piece.kind,
          outcome,
          cardId: piece.cardId,
          markId: piece.markId,
          ...(cards ? { cards } : {}),
        },
      }));
    },
    [piece],
  );

  const update = useCallback(
    (next: Partial<PieceState>) => {
      if (!piece) return;
      const merged = { ...state, ...next };
      setStates((current) => ({ ...current, [piece.id]: merged }));
      const outcome = checkedOutcome(piece.body, merged);
      if (outcome && !results[piece.id]) record(outcome);
    },
    [piece, record, results, state],
  );

  const grade = useCallback(
    (outcome: ReviewOutcome, cards?: { cardId: string; knew: boolean }[]) => {
      record(outcome, cards);
      go(index + 1);
    },
    [go, index, record],
  );

  // A listening piece starts with the teacher's voice, as a class would.
  useEffect(() => {
    if (piece?.body.type === "choice" && piece.body.listen && !state.revealed) {
      play(piece.body.listen);
    }
    // Only when a piece opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (typing) return;
      if (!piece) {
        if (event.key === "ArrowLeft") go(index - 1);
        return;
      }
      const body = piece.body;
      const answered = Boolean(results[piece.id]);
      if (event.key === "ArrowRight" || (event.key === "Enter" && answered)) {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === " ") {
        event.preventDefault();
        if (
          (body.type === "reveal" || body.type === "cards") &&
          !state.revealed
        ) {
          update({ revealed: true });
        } else if (answered) {
          go(index + 1);
        }
      } else if (event.key === "r" || event.key === "R") {
        const clip =
          body.type === "choice" && body.listen ? body.listen : piece.clips[0];
        if (clip) play(clip);
      } else if (/^[1-9]$/.test(event.key)) {
        const number = Number(event.key);
        if (body.type === "reveal" && state.revealed && number <= 3) {
          grade(number === 1 ? "missed" : number === 2 ? "shaky" : "knew");
        } else if (
          body.type === "choice" &&
          state.pick === null &&
          number <= body.options.length
        ) {
          update({ pick: number - 1, revealed: true });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go, grade, index, piece, play, results, state, update]);

  const planned =
    pieces.reduce((total, entry) => total + entry.seconds, 0) + WRAP_UP_SECONDS;
  const elapsed = (now - startedAt.current.getTime()) / 1000;
  const left = length * 60 - elapsed;

  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    void getCurrentWindow()
      .setFullscreen(next)
      .catch(() => setFullscreen(!next));
  };

  const done = ordered();
  const score = runScore(done);
  const back = intoPractice(pieces, done);

  return createPortal(
    <LessonLanguageProvider language={plan.learning}>
      <div
        className="dark fixed inset-0 z-[60] flex flex-col bg-[#18261F] text-[#F1EFE7]"
        role="dialog"
        aria-modal="true"
        aria-label={t`Review of ${title}`}
      >
        <header className="flex flex-wrap items-center gap-3.5 border-b border-[#344E40] bg-[#1C2D24] px-7 py-3">
          <button
            type="button"
            onClick={close}
            className="flex size-11 items-center justify-center rounded-[11px] border border-[#4B6A58] hover:bg-[#284034]"
            aria-label={t`Stop the review`}
          >
            <X className="size-4" />
          </button>
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-sm font-semibold">
              <Trans>Review · {title}</Trans>
            </b>
            <span className={cn(["text-xs", focus.muted])}>
              {length === 5 ? (
                <Trans>5 minutes</Trans>
              ) : (
                <Trans>10 minutes</Trans>
              )}
              {plan.withAi ? (
                <>
                  {" · "}
                  <Trans>some pieces written by the AI</Trans>
                </>
              ) : null}
            </span>
          </div>
          <div className="ml-auto flex items-baseline gap-2" aria-live="off">
            <span className="font-mono text-xl font-medium">
              {wrapUp ? t`Done` : left >= 0 ? clock(left) : `+${clock(left)}`}
            </span>
            <small className={cn(["text-xs", focus.muted])}>
              {wrapUp
                ? t`in ${clock(elapsed)}`
                : left >= 0
                  ? t`left of ${length} min`
                  : t`over, no rush`}
            </small>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex size-11 items-center justify-center rounded-[11px] border border-[#4B6A58] hover:bg-[#284034]"
            aria-label={fullscreen ? t`Leave full screen` : t`Full screen`}
          >
            {fullscreen ? (
              <ArrowsInSimple className="size-4" />
            ) : (
              <ArrowsOutSimple className="size-4" />
            )}
          </button>
        </header>

        <nav
          className="flex gap-1.5 px-7 pt-3.5"
          aria-label={t`Pieces in this review`}
        >
          {pieces.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => go(position)}
              style={{ flexGrow: entry.seconds }}
              className={cn([
                "flex min-w-0 basis-0 flex-col gap-1.5 pb-1 text-left text-xs font-semibold",
                position === index ? "text-[#F1EFE7]" : focus.muted,
              ])}
              aria-current={position === index ? "step" : undefined}
            >
              <i
                className={cn([
                  "block h-1.5 rounded-full",
                  position === index
                    ? "bg-[#E3B23C]"
                    : position < index || results[entry.id]
                      ? "bg-[#E3B23C]/50"
                      : "bg-[#344E40]",
                ])}
              />
              <span className="truncate">{kindLabels[entry.kind]}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => go(pieces.length)}
            style={{ flexGrow: WRAP_UP_SECONDS }}
            className={cn([
              "flex min-w-0 basis-0 flex-col gap-1.5 pb-1 text-left text-xs font-semibold",
              wrapUp ? "text-[#F1EFE7]" : focus.muted,
            ])}
          >
            <i
              className={cn([
                "block h-1.5 rounded-full",
                wrapUp ? "bg-[#E3B23C]" : "bg-[#344E40]",
              ])}
            />
            <span className="truncate">
              <Trans>Wrap-up</Trans>
            </span>
          </button>
        </nav>

        <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-3.5 overflow-y-auto px-10 pt-5 pb-4">
          {piece ? (
            <>
              <div
                className={cn([
                  "flex flex-wrap items-center gap-2.5 text-sm",
                  focus.muted,
                ])}
              >
                <b className="font-semibold text-[#F1EFE7]">
                  <Trans>
                    {index + 1} of {pieces.length + 1} ·{" "}
                    {kindLabels[piece.kind]}
                  </Trans>
                </b>
                {piece.source ? (
                  <span
                    className={cn([
                      "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                      piece.written
                        ? "border-[#7D6A35] text-[#F3D58C]"
                        : "border-[#4B6A58]",
                    ])}
                  >
                    {piece.source}
                  </span>
                ) : null}
                {piece.written && !/review/i.test(piece.source) ? (
                  <span className="rounded-full border border-[#7D6A35] px-2.5 py-0.5 text-xs font-semibold text-[#F3D58C]">
                    <Trans>Written for review</Trans>
                  </span>
                ) : null}
              </div>
              <h2 className="font-brand max-w-[960px] text-[28px] leading-tight font-medium text-pretty">
                {piece.prompt}
              </h2>
              <PieceView
                key={piece.id}
                piece={piece}
                state={state}
                update={update}
                onGrade={grade}
                onNext={() => go(index + 1)}
                onPlay={play}
              />
            </>
          ) : (
            <WrapUp
              title={title}
              seconds={elapsed}
              pieces={pieces}
              results={results}
              kindLabels={kindLabels}
              right={score.right}
              total={score.total}
              back={back}
              length={length}
              canGoLonger={length === 5 && plan.pieces.length > pieces.length}
              onClose={close}
              onLonger={() => onLength(10)}
            />
          )}
        </main>

        <footer className="flex flex-wrap items-center gap-4 border-t border-[#344E40] bg-[#1C2D24] px-7 py-2.5">
          <div className={cn(["flex flex-wrap gap-3.5 text-xs", focus.muted])}>
            <span>
              <Key>Space</Key> <Trans>show</Trans>
            </span>
            <span>
              <Key>1</Key>
              <Key>2</Key>
              <Key>3</Key> <Trans>how it went</Trans>
            </span>
            <span>
              <Key>R</Key> <Trans>teacher again</Trans>
            </span>
            <span>
              <Key>←</Key>
              <Key>→</Key> <Trans>back and on</Trans>
            </span>
            <span>
              <Key>Esc</Key> <Trans>stop</Trans>
            </span>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className={focus.quiet}
              onClick={() => go(index - 1)}
              disabled={index === 0}
            >
              <Trans>Back</Trans>
            </button>
            {!wrapUp ? (
              <button
                type="button"
                className={focus.quiet}
                onClick={() => go(index + 1)}
              >
                {results[piece!.id] ? <Trans>Next</Trans> : <Trans>Skip</Trans>}
              </button>
            ) : null}
          </div>
          <span className="sr-only">{t`About ${Math.round(planned / 60)} minutes planned`}</span>
        </footer>
      </div>
    </LessonLanguageProvider>,
    window.document.body,
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-b-2 border-[#4B6A58] px-1.5 font-mono text-[11px]">
      {children}
    </kbd>
  );
}

function WrapUp({
  seconds,
  pieces,
  results,
  kindLabels,
  right,
  total,
  back,
  canGoLonger,
  onClose,
  onLonger,
}: {
  title: string;
  seconds: number;
  pieces: ReturnType<typeof piecesFor>;
  results: Record<string, ReviewResult>;
  kindLabels: Record<string, string>;
  right: number;
  total: number;
  back: string[];
  length: ReviewLength;
  canGoLonger: boolean;
  onClose: () => void;
  onLonger: () => void;
}) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return (
    <>
      <div className={cn(["text-sm font-semibold", focus.muted])}>
        <Trans>Wrap-up</Trans>
      </div>
      <h2 className="font-brand text-[28px] leading-tight font-medium">
        <Trans>
          Done in {minutes} min {rest} s. {right} of {total} right.
        </Trans>
      </h2>
      <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        <section className={cn([focus.card, "flex flex-col gap-2"])}>
          <p className={focus.label}>
            <Trans>How it went</Trans>
          </p>
          <ul className="flex flex-col gap-2">
            {pieces.map((piece) => {
              const result = results[piece.id];
              return (
                <li
                  key={piece.id}
                  className="flex items-center gap-3 rounded-xl border border-[#344E40] bg-[#18261F] px-3.5 py-2.5 text-sm"
                >
                  <b className="font-semibold">{kindLabels[piece.kind]}</b>
                  <span className={cn(["truncate", focus.muted])}>
                    {piece.prompt}
                  </span>
                  <span
                    className={cn([
                      "ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      !result && "border border-[#4B6A58] text-[#B5C2B9]",
                      result?.outcome === "knew" &&
                        "bg-[#1F4130] text-[#9BD8AE]",
                      result?.outcome === "shaky" &&
                        "border border-[#7D6A35] text-[#F3D58C]",
                      result?.outcome === "missed" &&
                        "bg-[#4A2D22] text-[#F2A585]",
                    ])}
                  >
                    {!result ? (
                      <Trans>Skipped</Trans>
                    ) : result.outcome === "knew" ? (
                      <Trans>Knew it</Trans>
                    ) : result.outcome === "shaky" ? (
                      <Trans>Shaky</Trans>
                    ) : (
                      <Trans>Missed it</Trans>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className={cn([focus.answer, "flex flex-col gap-3"])}>
          <div className="flex flex-col gap-1.5 rounded-xl border border-[#344E40] bg-[#18261F] p-3.5">
            <h3 className={focus.label}>
              <Trans>Into Practise</Trans>
            </h3>
            {back.length > 0 ? (
              <p className="text-sm">{back.join(" · ")}</p>
            ) : (
              <p className="text-sm">
                <Trans>Nothing new. Cards you knew stay where they were.</Trans>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl border border-[#344E40] bg-[#18261F] p-3.5">
            <h3 className={focus.label}>
              <Trans>Next review</Trans>
            </h3>
            <p className="text-sm">
              <Trans>
                In two days, then before the next class. A few short reviews
                stick better than one long one.
              </Trans>
            </p>
          </div>
          <div className="mt-auto flex flex-wrap justify-end gap-2">
            <button type="button" className={focus.quiet} onClick={onClose}>
              <Trans>Back to the study sheet</Trans>
            </button>
            {canGoLonger ? (
              <button
                type="button"
                className={focus.primary}
                onClick={onLonger}
              >
                <Trans>Play the 10-minute review</Trans>
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
