import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ArrowsClockwise,
  BookOpen,
  Check,
  DownloadSimple,
  Flag,
  GraduationCap,
  Pause,
  Play,
  Star,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { requestLessonSheet, useLessonSheetStatus } from "../auto";
import { correctionClips, findTermOccurrences, pickTermClip } from "../clips";
import { useLessonDocument } from "../documents";
import { exportVocabulary, type VocabularyExportFormat } from "../export";
import { computeTalkStats } from "../generate";
import {
  addHomeworkTodo,
  courseHomework,
  homeworkTodoId,
  setHomeworkDone,
  useHomeworkStatuses,
  useHomeworkTodoIds,
} from "../homework";
import { chineseShare, computeChineseStats } from "../language";
import {
  setLessonQuestionAsked,
  useCourseMarks,
  useLessonMarks,
} from "../marks";
import { setWordCard } from "../practice";
import { usePracticeDue } from "../practice-data";
import {
  useCourseLessons,
  useCourseSheets,
  useLessonSession,
  useLessonSheet,
} from "../queries";
import { parseLessonPractice } from "../schema";
import { toggleSheetClip, trackSheetClip, useSheetClip } from "../sheet-clip";
import { formatClock } from "../time";
import type { LessonMarkKind, LessonSheet } from "../types";
import { useLessonTranscript } from "../use-lesson-segments";
import { LessonPracticeDialog } from "./practice-dialog";
import { openCourse } from "./sidebar-courses";
import { LessonTerm } from "./term";
import { ToneLegend } from "./tone-legend";

import { useLanguageModel } from "~/ai/hooks";
import { useAudioPlayer } from "~/audio-player/provider";
import { ChineseDisplayMenu } from "~/session/components/note-input/transcript/display-menu";
import { useSession } from "~/session/queries";
import { hasHan } from "~/stt/pinyin";

export function LessonStudySheet({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const lesson = useLessonSession(sessionId);
  const sheetDocument = useLessonSheet(sessionId);
  const marks = useLessonMarks(sessionId);
  const status = useLessonSheetStatus((state) => state.bySession[sessionId]);
  const model = useLanguageModel("enhance");
  const session = useSession(sessionId);
  const [practising, setPractising] = useState(false);
  const courseLessons = useCourseLessons(lesson.folderPath);
  const courseSheets = useCourseSheets(lesson.folderPath);
  // Practising from a sheet also brings back earlier lessons' words that are due.
  const practiceIds = useMemo(
    () =>
      courseLessons.some((item) => item.id === sessionId)
        ? courseLessons.map((item) => item.id)
        : [sessionId],
    [courseLessons, sessionId],
  );
  const practice = usePracticeDue(practiceIds, sessionId);
  useSheetClipTracker();

  // Lessons are listed newest first; number them from the course's first.
  const index = courseLessons.findIndex((item) => item.id === sessionId);
  const lessonNumber = index >= 0 ? courseLessons.length - index : null;
  const row = index >= 0 ? courseLessons[index] : undefined;
  const previous = index >= 0 ? courseLessons[index + 1] : undefined;
  const numberOf = useMemo(
    () =>
      new Map(
        courseLessons.map((item, position) => [
          item.id,
          courseLessons.length - position,
        ]),
      ),
    [courseLessons],
  );
  // The earliest earlier lesson whose sheet had each word, for "Lesson 2" badges.
  const firstLessonOf = useMemo(() => {
    const first = new Map<string, number>();
    for (const [id, document] of courseSheets) {
      const number = numberOf.get(id);
      if (!number || id === sessionId) continue;
      if (lessonNumber !== null && number >= lessonNumber) continue;
      for (const item of document.sheet.vocabulary) {
        const known = first.get(item.term);
        if (known === undefined || number < known) first.set(item.term, number);
      }
    }
    return first;
  }, [courseSheets, lessonNumber, numberOf, sessionId]);

  const write = () =>
    void requestLessonSheet(sessionId, model, { force: true });

  if (!lesson.isLesson) return null;
  const sheet = sheetDocument?.sheet ?? null;
  const courseName = lesson.folderPath.split("/").pop() || lesson.folderPath;
  const title = sheet?.topic || session?.title || t`Lesson`;
  const started = row?.started_at || row?.created_at || session?.created_at;
  const audioMs = Number(row?.audio_ms ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-1 pt-2 pb-16">
      {status?.state === "writing" ? (
        <Banner>
          <Spinner className="size-4" />
          <Trans>Writing the study sheet from the lesson…</Trans>
        </Banner>
      ) : null}
      {status?.state === "error" ? (
        <Banner tone="error">
          <span className="flex-1">
            <Trans>Couldn't write the study sheet: {status.message}</Trans>
          </span>
          <Button size="sm" variant="outline" onClick={write}>
            <Trans>Try again</Trans>
          </Button>
        </Banner>
      ) : null}

      {!sheet && status?.state !== "writing" ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-6">
          <p className="text-muted-foreground text-sm">
            <Trans>
              When the lesson's summary is ready, the AI picked in Settings ›
              Intelligence writes its study sheet here: words, patterns,
              corrections and homework.
            </Trans>
          </p>
          <Button size="sm" onClick={write} disabled={!model}>
            <Trans>Write it now</Trans>
          </Button>
        </div>
      ) : null}

      {sheet ? (
        <>
          <header className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b pb-5">
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
              {lesson.folderPath ? (
                <button
                  type="button"
                  onClick={() => openCourse(lesson.folderPath)}
                  className="text-muted-foreground hover:text-foreground w-fit text-xs font-medium"
                >
                  {lessonNumber !== null ? (
                    <Trans>
                      {courseName} · Lesson {lessonNumber}
                    </Trans>
                  ) : (
                    courseName
                  )}
                </button>
              ) : null}
              <h1 className="font-brand text-3xl leading-tight font-medium">
                {title}
              </h1>
              <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {started ? (
                  <span>
                    {new Date(started).toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                ) : null}
                {audioMs >= 60_000 ? (
                  <span>
                    <Trans>{Math.round(audioMs / 60_000)} min</Trans>
                  </span>
                ) : null}
                {sheetDocument?.model ? (
                  <span>
                    <Trans>
                      Written up by {sheetDocument.model}, picked in
                      Intelligence
                    </Trans>
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ChineseDisplayMenu
                lesson
                label={t`Pinyin and tones`}
                triggerClassName="h-8 px-3 text-sm"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={write}
                disabled={!model || status?.state === "writing"}
              >
                <ArrowsClockwise className="size-3.5" />
                <Trans>Write again</Trans>
              </Button>
              <Button
                size="sm"
                onClick={() => setPractising(true)}
                disabled={practice.due === 0}
              >
                {practice.due > 0 ? (
                  <Trans>Practise {practice.due} cards</Trans>
                ) : sheet.vocabulary.length > 0 ? (
                  <Trans>All practised for now</Trans>
                ) : (
                  <Trans>No words to practise</Trans>
                )}
              </Button>
            </div>
          </header>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-w-0 flex-col gap-8">
              <p className="font-brand text-xl leading-relaxed">
                {sheet.summary}
              </p>
              <Words
                sessionId={sessionId}
                sheet={sheet}
                firstLessonOf={firstLessonOf}
              />
              <Patterns sessionId={sessionId} sheet={sheet} />
              <Corrections sessionId={sessionId} sheet={sheet} />
              <Marks sessionId={sessionId} sheet={sheet} marks={marks} />
              <Homework sessionId={sessionId} sheet={sheet} />
            </div>
            <aside
              aria-label={t`Lesson at a glance`}
              className="flex flex-col gap-3.5 lg:sticky lg:top-2 lg:self-start"
            >
              <ThisLesson
                sessionId={sessionId}
                sheet={sheet}
                previousId={previous?.id}
                previousNumber={lessonNumber !== null ? lessonNumber - 1 : null}
              />
              <RailPanel title={t`Practise`}>
                <span className="font-brand text-mirna-serra dark:text-mirna-moss text-3xl leading-none font-medium">
                  {practice.due - practice.fromOtherLessons}
                </span>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  <Trans>
                    cards from this lesson, each with your teacher's voice.
                  </Trans>{" "}
                  {practice.fromOtherLessons === 1 ? (
                    <Trans>1 more is due from an earlier lesson.</Trans>
                  ) : practice.fromOtherLessons > 1 ? (
                    <Trans>
                      {practice.fromOtherLessons} more are due from earlier
                      lessons.
                    </Trans>
                  ) : null}
                </p>
                <Button
                  size="sm"
                  onClick={() => setPractising(true)}
                  disabled={practice.due === 0}
                >
                  <Trans>Start practice</Trans>
                </Button>
              </RailPanel>
              {lesson.folderPath ? (
                <NextClass
                  folderPath={lesson.folderPath}
                  lessonIds={practiceIds}
                />
              ) : null}
              <TakeElsewhere
                sheet={sheet}
                lessonTitle={session?.title || t`Lesson`}
              />
            </aside>
          </div>
        </>
      ) : null}

      {practising ? (
        <LessonPracticeDialog
          sessionIds={practiceIds}
          focusSessionId={sessionId}
          title={session?.title || t`This lesson`}
          onClose={() => setPractising(false)}
        />
      ) : null}
    </div>
  );
}

function Banner({
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

function Section({
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

function usePlayAt(sessionId: string) {
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
function useSheetClipTracker() {
  const { wavesurfer } = useAudioPlayer();
  useEffect(() => {
    if (!wavesurfer) return;
    return wavesurfer.on("timeupdate", (time) =>
      trackSheetClip(time, wavesurfer.isPlaying()),
    );
  }, [wavesurfer]);
}

function PlayButton({
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
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium disabled:opacity-40",
        playing
          ? "bg-mirna-serra border-mirna-serra dark:bg-mirna-moss dark:text-mirna-serra text-white"
          : "text-mirna-serra hover:bg-accent dark:text-mirna-moss",
      ])}
    >
      {playing ? (
        <Pause className="size-3" weight="bold" />
      ) : (
        <Play className="size-3" weight="bold" />
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

function Badge({
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

function Words({
  sessionId,
  sheet,
  firstLessonOf,
}: {
  sessionId: string;
  sheet: LessonSheet;
  firstLessonOf: ReadonlyMap<string, number>;
}) {
  const { t } = useLingui();
  const { canPlay, playTerm, isTermPlaying } = usePlayAt(sessionId);
  const practice = useLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
  );
  const skipped = new Set(practice?.skipped ?? []);
  if (sheet.vocabulary.length === 0) return null;
  const fresh = sheet.vocabulary.filter((item) => item.isNew).length;
  return (
    <Section
      title={<Trans>Words</Trans>}
      note={
        <Trans>
          {fresh} new · {sheet.vocabulary.length - fresh} from earlier lessons
        </Trans>
      }
    >
      {sheet.vocabulary.some((item) => hasHan(item.term)) ? (
        <ToneLegend />
      ) : null}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                <Trans>Word</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Pinyin</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Meaning</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Teacher says it</Trans>
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium">
                <Trans>Cards</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.vocabulary.map((item) => {
              const earlier = firstLessonOf.get(item.term);
              return (
                <tr key={item.term} className="border-t">
                  <td className="px-4 py-2 text-2xl">
                    <LessonTerm term={item.term} reading={item.reading} />
                  </td>
                  <td className="px-3 py-2">{item.reading}</td>
                  <td className="px-3 py-2">
                    {item.meaning}
                    {item.isNew ? (
                      <Badge tone="new">
                        <Trans>New</Trans>
                      </Badge>
                    ) : (
                      <Badge tone="old">
                        {earlier ? (
                          <Trans>Lesson {earlier}</Trans>
                        ) : (
                          <Trans>seen before</Trans>
                        )}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PlayButton
                      label={t`Play the teacher saying ${item.term}`}
                      time={item.heardAtMs}
                      disabled={!canPlay}
                      playing={isTermPlaying(item.term)}
                      onClick={() => playTerm(item.term, item.heardAtMs)}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="accent-mirna-serra size-4"
                      aria-label={t`Make a card for ${item.term}`}
                      checked={!skipped.has(item.term)}
                      onChange={(event) =>
                        void setWordCard(
                          sessionId,
                          item.term,
                          event.target.checked,
                        ).catch(() => toast.error(t`Couldn't save that.`))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Patterns({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  if (sheet.patterns.length === 0) return null;
  return (
    <Section
      title={<Trans>Patterns</Trans>}
      note={
        sheet.patterns.length === 1 ? (
          <Trans>1 from this class</Trans>
        ) : (
          <Trans>{sheet.patterns.length} from this class</Trans>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {sheet.patterns.map((pattern, index) => (
          <div
            key={`${pattern.pattern}-${index}`}
            className="flex flex-col gap-3 rounded-xl border p-4"
          >
            <div className="text-mirna-serra dark:text-mirna-moss font-semibold">
              <LessonTerm term={pattern.pattern} toneColours={false} />
            </div>
            {pattern.examples.map((example, exampleIndex) => (
              <div key={exampleIndex} className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-base">
                    <LessonTerm term={example.text} />
                  </div>
                  {example.translation ? (
                    <div className="text-muted-foreground text-xs">
                      {example.translation}
                    </div>
                  ) : null}
                </div>
                {example.atMs !== null ? (
                  <PlayButton
                    label={t`Play this example`}
                    time={example.atMs}
                    disabled={!canPlay}
                    playing={isMomentPlaying(example.atMs!)}
                    onClick={() => playFrom(example.atMs!)}
                  />
                ) : null}
              </div>
            ))}
            {pattern.explanation ? (
              <p className="bg-mirna-mist/70 dark:bg-muted rounded-lg px-3 py-2 text-sm leading-relaxed">
                {pattern.explanation}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Corrections({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
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
  return (
    <Section
      title={<Trans>Corrections</Trans>}
      note={
        sheet.corrections.length === 1 ? (
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
                  <Trans>You said</Trans>
                </div>
                <div className="text-mirna-terra text-base line-through decoration-1">
                  {correction.said}
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
                  <LessonTerm term={correction.corrected} />
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

const MARK_META: Record<
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

function Marks({
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

function Homework({
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

function RailPanel({
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

function formatMinutes(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds % 60} s`;
}

/** Who talked and how much was in Chinese, worked out from the transcript. */
function ThisLesson({
  sessionId,
  sheet,
  previousId,
  previousNumber,
}: {
  sessionId: string;
  sheet: LessonSheet;
  previousId: string | undefined;
  previousNumber: number | null;
}) {
  const { t } = useLingui();
  const { segments, roleOf, ready } = useLessonTranscript(sessionId);
  const before = useLessonTranscript(previousId);
  const talk = useMemo(
    () => (ready ? computeTalkStats(segments, roleOf) : sheet.talk),
    [ready, roleOf, segments, sheet.talk],
  );
  const chinese = useMemo(
    () => (ready ? computeChineseStats(segments, roleOf) : null),
    [ready, roleOf, segments],
  );
  const chineseBefore = useMemo(() => {
    if (!before.ready) return null;
    const stats = computeChineseStats(before.segments, before.roleOf);
    return stats ? chineseShare(stats) : null;
  }, [before.ready, before.roleOf, before.segments]);
  if (!talk && !chinese) return null;
  const spoke = talk
    ? Math.round((talk.studentMs / (talk.studentMs + talk.teacherMs)) * 100)
    : null;
  const inChinese = chinese ? chineseShare(chinese) : null;
  return (
    <RailPanel title={t`This lesson`}>
      {spoke !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">
              <Trans>You spoke</Trans>
            </span>
            <span className="font-mono text-xs">{spoke}%</span>
          </div>
          <div
            className="bg-muted rounded-pill flex h-2 overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="bg-mirna-serra h-full"
              style={{ width: `${spoke}%` }}
            />
            <span className="h-full flex-1 bg-[#A9C1E0]" />
          </div>
          <span className="text-muted-foreground text-xs">
            <Trans>Teacher {100 - spoke}%</Trans>
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>
            Voices weren't told apart, so there's no speaking share.
          </Trans>
        </p>
      )}
      {inChinese !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">
              <Trans>In Chinese</Trans>
            </span>
            <span className="font-mono text-xs">{inChinese}%</span>
          </div>
          <div
            className="bg-muted rounded-pill h-2 overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="bg-mirna-terra block h-full"
              style={{ width: `${inChinese}%` }}
            />
          </div>
          {chineseBefore !== null && previousNumber ? (
            <span className="text-muted-foreground text-xs">
              {inChinese >= chineseBefore ? (
                <Trans>
                  Up from {chineseBefore}% in lesson {previousNumber}
                </Trans>
              ) : (
                <Trans>
                  Down from {chineseBefore}% in lesson {previousNumber}
                </Trans>
              )}
            </span>
          ) : null}
        </div>
      ) : null}
      {chinese && spoke !== null ? (
        <div className="flex justify-between text-sm">
          <span className="font-semibold">
            <Trans>Your Chinese</Trans>
          </span>
          <span className="font-mono text-xs">
            {formatMinutes(chinese.studentChineseMs)}
          </span>
        </div>
      ) : null}
    </RailPanel>
  );
}

/** What's waiting for the next class across the course. */
function NextClass({
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

function TakeElsewhere({
  sheet,
  lessonTitle,
}: {
  sheet: LessonSheet;
  lessonTitle: string;
}) {
  const { t } = useLingui();
  const run = useMutation({
    mutationFn: (format: VocabularyExportFormat) =>
      exportVocabulary(
        format,
        sheet.vocabulary.map((item) => ({ ...item, lesson: lessonTitle })),
        lessonTitle,
      ),
    onSuccess: (path) => {
      if (path) toast.success(t`Saved ${path}`);
    },
    onError: () => toast.error(t`Couldn't save the file.`),
  });
  if (sheet.vocabulary.length === 0) return null;
  return (
    <RailPanel title={t`Take it elsewhere`}>
      {(
        [
          ["anki", t`Anki deck`],
          ["pleco", t`Pleco flashcards`],
        ] as const
      ).map(([format, name]) => (
        <button
          key={format}
          type="button"
          onClick={() => run.mutate(format)}
          className="hover:bg-accent flex items-center justify-between rounded-lg border bg-white/60 px-3 py-2 text-left text-sm font-medium dark:bg-transparent"
        >
          {name}
          <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
            <DownloadSimple className="size-3" />
            <Trans>text file</Trans>
          </span>
        </button>
      ))}
    </RailPanel>
  );
}
