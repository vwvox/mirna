import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, type ReactNode } from "react";

import {
  BookOpen,
  Check,
  Flag,
  GraduationCap,
  Pause,
  Play,
  Star,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { correctionClips, findTermOccurrences, pickTermClip } from "../clips";
import {
  addHomeworkTodo,
  courseHomework,
  homeworkTodoId,
  setHomeworkDone,
  useHomeworkStatuses,
  useHomeworkTodoIds,
} from "../homework";
import {
  setLessonQuestionAsked,
  useCourseMarks,
  useLessonMarks,
} from "../marks";
import { useCourseSheets } from "../queries";
import { toggleSheetClip, trackSheetClip, useSheetClip } from "../sheet-clip";
import { formatClock } from "../time";
import type { LessonMarkKind, LessonSheet } from "../types";
import { useLessonTranscript } from "../use-lesson-segments";
import { MathText } from "./math";
import { openCourse } from "./sidebar-courses";
import { LessonTerm } from "./term";

import { useAudioPlayer } from "~/audio-player/provider";

/** Pieces both study sheets (language and subject) are built from. */

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn([
        "flex items-center gap-3 rounded-lg px-4 py-3 text-sm",
        tone === "error"
          ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
          : "bg-mirna-moss/60 text-mirna-serra dark:bg-mirna-serra/30 dark:text-mirna-moss",
      ])}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-brand flex items-baseline gap-3 text-lg font-medium">
        {title}
        {note ? (
          <span className="text-muted-foreground font-sans text-xs font-normal">
            {note}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function usePlayAt(sessionId: string) {
  const player = useAudioPlayer();
  const { segments, roleOf } = useLessonTranscript(sessionId);
  const active = useSheetClip((state) => state.active);
  const controls = {
    state: player.state,
    currentTime: () => player.wavesurfer?.getCurrentTime() ?? null,
    pause: player.pause,
    playRange: player.playRange,
  };
  const isPlaying = (key: string) =>
    active?.key === key && player.state === "playing";
  return {
    canPlay: player.audioExists,
    segments,
    roleOf,
    isPlaying,
    playClip: (key: string, startMs: number, endMs: number) =>
      toggleSheetClip(controls, {
        key,
        startSec: startMs / 1000,
        endSec: endMs / 1000,
      }),
    isTermPlaying: (term: string) => isPlaying(`term:${term}`),
    isMomentPlaying: (ms: number, seconds = 8) =>
      isPlaying(`at:${ms}:${seconds}`),
    playTerm: (term: string, aroundMs: number | null) => {
      const clip = pickTermClip(
        findTermOccurrences(segments, term, roleOf),
        aroundMs,
      );
      const range = clip
        ? { startSec: clip.startMs / 1000, endSec: clip.endMs / 1000 }
        : aroundMs !== null
          ? { startSec: aroundMs / 1000, endSec: aroundMs / 1000 + 4 }
          : null;
      if (range) toggleSheetClip(controls, { key: `term:${term}`, ...range });
    },
    playFrom: (ms: number, seconds = 8) =>
      toggleSheetClip(controls, {
        key: `at:${ms}:${seconds}`,
        startSec: Math.max(0, ms - 500) / 1000,
        endSec: ms / 1000 + seconds,
      }),
  };
}

/** Keeps the sheet's pause buttons honest when playback moves elsewhere. */
export function useSheetClipTracker() {
  const { wavesurfer } = useAudioPlayer();
  useEffect(() => {
    if (!wavesurfer) return;
    return wavesurfer.on("timeupdate", (time) =>
      trackSheetClip(time, wavesurfer.isPlaying()),
    );
  }, [wavesurfer]);
}

/**
 * A study sheet table keeps its columns while it has room and turns each row
 * into a small card when it doesn't: the first cell with its play button and
 * card box beside it, the other cells below. It goes by its own width, since the
 * sheet sits beside the notes list and the rail in a window of any size.
 */
export const sheetTable = {
  frame: "@container overflow-x-auto rounded-xl border",
  table: "w-full border-collapse text-sm @max-xl:block",
  head: "bg-muted/50 text-muted-foreground text-left text-xs @max-xl:hidden",
  body: "@max-xl:block",
  row: "border-t @max-xl:grid @max-xl:grid-cols-[minmax(0,1fr)_auto_auto] @max-xl:items-center @max-xl:gap-x-3 @max-xl:gap-y-1.5 @max-xl:px-4 @max-xl:py-3 @max-xl:first:border-t-0",
  first: "@max-xl:p-0",
  below: "@max-xl:col-span-3 @max-xl:p-0",
  play: "@max-xl:col-start-2 @max-xl:row-start-1 @max-xl:p-0",
  card: "@max-xl:col-start-3 @max-xl:row-start-1 @max-xl:p-0",
  // Wide enough for a play button with its time, which WebKit's table
  // layout otherwise measures short and cuts off.
  playColumn: "w-28",
};

export function PlayButton({
  label,
  time,
  text,
  onClick,
  disabled,
  playing = false,
}: {
  label: string;
  time?: number | null;
  /** A word next to the icon, such as "You" or "Teacher". */
  text?: string;
  onClick: () => void;
  disabled?: boolean;
  playing?: boolean;
}) {
  const { t } = useLingui();
  const name = playing ? t`Pause` : label;
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={playing}
      title={name}
      disabled={disabled}
      onClick={onClick}
      className={cn([
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap disabled:opacity-40",
        playing
          ? "bg-mirna-serra border-mirna-serra dark:bg-mirna-moss dark:text-mirna-serra text-white"
          : "text-mirna-serra hover:bg-accent dark:text-mirna-moss",
      ])}
    >
      {/* A narrow table column squeezed the icon to nothing without shrink-0. */}
      {playing ? (
        <Pause className="size-3 shrink-0" weight="bold" />
      ) : (
        <Play className="size-3 shrink-0" weight="bold" />
      )}
      {text ? <span>{text}</span> : null}
      {time !== undefined && time !== null ? (
        <span
          className={cn([
            "font-mono",
            playing
              ? "dark:text-mirna-serra/80 text-white/80"
              : "text-muted-foreground",
          ])}
        >
          {formatClock(time)}
        </span>
      ) : null}
    </button>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "new" | "old";
}) {
  return (
    <span
      className={cn([
        "rounded-pill ml-2 inline-block px-2 py-0.5 align-middle text-[11px] font-semibold",
        tone === "new"
          ? "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss"
          : "bg-muted text-muted-foreground",
      ])}
    >
      {children}
    </span>
  );
}

export function Corrections({
  sessionId,
  sheet,
  variant = "language",
}: {
  sessionId: string;
  sheet: LessonSheet;
  /** On topic and maths sheets these are common slips, by anyone in class. */
  variant?: "language" | "subject";
}) {
  const { t } = useLingui();
  const {
    canPlay,
    playFrom,
    isMomentPlaying,
    playClip,
    isPlaying,
    segments,
    roleOf,
  } = usePlayAt(sessionId);
  if (sheet.corrections.length === 0) return null;
  const slips = variant === "subject";
  return (
    <Section
      title={slips ? <Trans>Common slips</Trans> : <Trans>Corrections</Trans>}
      note={
        slips ? (
          sheet.corrections.length === 1 ? (
            <Trans>once you or the class went wrong</Trans>
          ) : (
            <Trans>
              {sheet.corrections.length} times you or the class went wrong
            </Trans>
          )
        ) : sheet.corrections.length === 1 ? (
          <Trans>once the teacher fixed what you said</Trans>
        ) : (
          <Trans>
            {sheet.corrections.length} times the teacher fixed what you said
          </Trans>
        )
      }
    >
      <ul className="flex flex-col gap-2">
        {sheet.corrections.map((correction, index) => {
          const clips =
            correction.atMs !== null
              ? correctionClips(segments, roleOf, correction.atMs)
              : { you: null, teacher: null };
          return (
            <li
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-4 py-3"
            >
              <div>
                <div className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {slips ? <Trans>Said</Trans> : <Trans>You said</Trans>}
                </div>
                <div className="text-mirna-terra text-base line-through decoration-1">
                  {slips ? (
                    <MathText
                      text={correction.said}
                      className="relative inline-block after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-current after:content-['']"
                    />
                  ) : (
                    correction.said
                  )}
                </div>
              </div>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <div>
                <div className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  <Trans>Teacher said</Trans>
                </div>
                <div className="text-mirna-serra dark:text-mirna-moss text-base font-medium">
                  {slips ? (
                    <MathText text={correction.corrected} />
                  ) : (
                    <LessonTerm term={correction.corrected} />
                  )}
                </div>
                {correction.why ? (
                  <div className="text-muted-foreground text-xs">
                    {correction.why}
                  </div>
                ) : null}
              </div>
              {clips.you || clips.teacher ? (
                <div className="flex flex-col gap-1.5">
                  {(
                    [
                      ["you", clips.you, t`You`],
                      ["teacher", clips.teacher, t`Teacher`],
                    ] as const
                  ).map(([who, clip, name]) =>
                    clip ? (
                      <PlayButton
                        key={who}
                        label={
                          who === "you"
                            ? t`Play what you said`
                            : t`Play the teacher's correction`
                        }
                        text={name}
                        disabled={!canPlay}
                        playing={isPlaying(`correction:${index}:${who}`)}
                        onClick={() =>
                          playClip(
                            `correction:${index}:${who}`,
                            clip.startMs,
                            clip.endMs,
                          )
                        }
                      />
                    ) : null,
                  )}
                </div>
              ) : correction.atMs !== null ? (
                <PlayButton
                  label={t`Play this moment`}
                  time={correction.atMs}
                  disabled={!canPlay}
                  playing={isMomentPlaying(correction.atMs, 10)}
                  onClick={() => playFrom(correction.atMs!, 10)}
                />
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export const MARK_META: Record<
  LessonMarkKind,
  { icon: typeof Star; className: string }
> = {
  important: {
    icon: Star,
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
  confused: {
    icon: Flag,
    className:
      "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  },
  homework: {
    icon: BookOpen,
    className:
      "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss",
  },
};

export function useMarkLabels(): Record<LessonMarkKind, string> {
  const { t } = useLingui();
  return {
    important: t`Important`,
    confused: t`Didn't get it`,
    homework: t`Homework`,
  };
}

export function Marks({
  sessionId,
  sheet,
  marks,
}: {
  sessionId: string;
  sheet: LessonSheet;
  marks: ReturnType<typeof useLessonMarks>;
}) {
  const { t } = useLingui();
  const labels = useMarkLabels();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  const answers = useMemo(
    () =>
      new Map(
        sheet.markAnswers.map((answer) => [answer.markId, answer.answer]),
      ),
    [sheet.markAnswers],
  );
  const questions = marks.questions;
  if (
    marks.marks.length === 0 &&
    questions.length === 0 &&
    sheet.openQuestions.length === 0
  )
    return null;
  return (
    <Section title={<Trans>Your marks and questions</Trans>}>
      <ul className="flex flex-col gap-2">
        {marks.marks.map((mark) => {
          const meta = MARK_META[mark.kind];
          const Icon = meta.icon;
          return (
            <li
              key={mark.id}
              className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border px-4 py-3"
            >
              <span className="text-muted-foreground pt-0.5 font-mono text-xs">
                {formatClock(mark.atMs)}
              </span>
              <div className="flex flex-col gap-1">
                <span
                  className={cn([
                    "rounded-pill inline-flex w-fit items-center gap-1 px-2 py-0.5 text-[11px] font-semibold",
                    meta.className,
                  ])}
                >
                  <Icon className="size-3" />
                  {labels[mark.kind]}
                </span>
                {mark.note ? (
                  <span className="text-sm">{mark.note}</span>
                ) : null}
                {answers.get(mark.id) ? (
                  <p className="border-mirna-moss border-l-2 pl-3 text-sm leading-relaxed">
                    {answers.get(mark.id)}
                  </p>
                ) : null}
              </div>
              <PlayButton
                label={t`Replay this moment`}
                disabled={!canPlay}
                playing={isMomentPlaying(mark.atMs, 30)}
                onClick={() => playFrom(mark.atMs, 30)}
              />
            </li>
          );
        })}
        {questions.map((question) => (
          <li
            key={question.id}
            className="flex items-start gap-3 rounded-xl border px-4 py-3"
          >
            <input
              type="checkbox"
              className="accent-mirna-serra mt-1 size-4"
              aria-label={t`Asked`}
              checked={question.asked}
              onChange={(event) =>
                void setLessonQuestionAsked(
                  sessionId,
                  question.id,
                  event.target.checked,
                )
              }
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{question.text}</span>
              <span className="text-muted-foreground text-xs">
                {question.asked ? (
                  <Trans>Asked</Trans>
                ) : (
                  <Trans>Question for the next class</Trans>
                )}
              </span>
            </div>
          </li>
        ))}
        {sheet.openQuestions.map((question, index) => (
          <li
            key={`open-${index}`}
            className="text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-sm"
          >
            <Trans>Not answered in class:</Trans> {question}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Homework({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const added = useHomeworkTodoIds(sessionId);
  const ids = useMemo(() => [sessionId], [sessionId]);
  const statuses = useHomeworkStatuses(ids);
  const add = useMutation({
    mutationFn: (item: { text: string; due: string }) =>
      addHomeworkTodo(sessionId, item),
    onError: () => toast.error(t`Couldn't add it to your to-dos.`),
  });
  const tick = useMutation({
    mutationFn: ({
      item,
      done,
    }: {
      item: { text: string; due: string };
      done: boolean;
    }) => setHomeworkDone(sessionId, item, done),
    onError: () => toast.error(t`Couldn't update the homework.`),
  });
  if (sheet.homework.length === 0) return null;
  return (
    <Section title={<Trans>Homework</Trans>}>
      <ul className="flex flex-col gap-2">
        {sheet.homework.map((item, index) => {
          const id = homeworkTodoId(sessionId, item.text);
          const isAdded = added.has(id);
          const done = statuses.get(id) === "done";
          return (
            <li
              key={index}
              className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
            >
              <input
                type="checkbox"
                className="accent-mirna-serra size-4"
                aria-label={t`Done: ${item.text}`}
                checked={done}
                disabled={tick.isPending}
                onChange={(event) =>
                  tick.mutate({ item, done: event.target.checked })
                }
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn([
                    "text-sm font-semibold",
                    done && "text-muted-foreground line-through",
                  ])}
                >
                  {item.text}
                </span>
                <span className="text-muted-foreground text-xs">
                  {item.atMs !== null ? (
                    <Trans>Heard at {formatClock(item.atMs)}</Trans>
                  ) : null}
                </span>
              </div>
              {item.due ? (
                <span className="text-mirna-terra rounded-pill bg-orange-50 px-2.5 py-0.5 text-xs font-semibold dark:bg-orange-950/40">
                  {item.due}
                </span>
              ) : null}
              {done ? null : isAdded ? (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Check className="size-3.5" />
                  <Trans>In your to-dos</Trans>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={add.isPending}
                  onClick={() => add.mutate(item)}
                >
                  <Trans>Add to to-dos</Trans>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function RailPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-mirna-mist/60 dark:bg-card flex flex-col gap-2.5 rounded-2xl border p-4">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function formatMinutes(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds % 60} s`;
}

/** What's waiting for the next class across the course. */
export function NextClass({
  folderPath,
  lessonIds,
}: {
  folderPath: string;
  lessonIds: string[];
}) {
  const { t } = useLingui();
  const marks = useCourseMarks(lessonIds);
  const sheets = useCourseSheets(folderPath);
  const statuses = useHomeworkStatuses(lessonIds);
  let questions = 0;
  for (const document of marks.values()) {
    questions += document.questions.filter(
      (question) => !question.asked,
    ).length;
  }
  const homework = courseHomework(
    lessonIds.map((id) => ({
      sessionId: id,
      title: "",
      homework: sheets.get(id)?.sheet.homework ?? [],
    })),
    statuses,
  ).filter((item) => !item.done).length;
  return (
    <RailPanel title={t`Next class`}>
      <p className="text-sm">
        {questions === 1 ? (
          <Trans>1 question to ask</Trans>
        ) : (
          <Trans>{questions} questions to ask</Trans>
        )}{" "}
        ·{" "}
        {homework === 1 ? (
          <Trans>1 homework item open</Trans>
        ) : (
          <Trans>{homework} homework items open</Trans>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => openCourse(folderPath)}
      >
        <GraduationCap className="size-3.5" />
        <Trans>Open the course</Trans>
      </Button>
    </RailPanel>
  );
}
