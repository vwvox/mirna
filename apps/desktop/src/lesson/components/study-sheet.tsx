import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import {
  ArrowsClockwise,
  BookOpen,
  Check,
  DownloadSimple,
  Flag,
  GraduationCap,
  Play,
  Star,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { requestLessonSheet, useLessonSheetStatus } from "../auto";
import { findTermOccurrences, pickTermClip } from "../clips";
import { exportVocabulary, type VocabularyExportFormat } from "../export";
import { computeTalkStats } from "../generate";
import {
  addHomeworkTodo,
  homeworkTodoId,
  useHomeworkTodoIds,
} from "../homework";
import { chineseShare, computeChineseStats } from "../language";
import { setLessonQuestionAsked, useLessonMarks } from "../marks";
import { usePracticeDue } from "../practice-data";
import { useCourseLessons, useLessonSession, useLessonSheet } from "../queries";
import { formatClock } from "../time";
import type { LessonMarkKind, LessonSheet } from "../types";
import { useLessonTranscript } from "../use-lesson-segments";
import { LessonPracticeDialog } from "./practice-dialog";
import { openCourse } from "./sidebar-courses";
import { LessonTerm } from "./term";
import { ToneLegend } from "./tone-legend";

import { useLanguageModel } from "~/ai/hooks";
import { useAudioPlayer } from "~/audio-player/provider";
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
  // Practising from a sheet also brings back earlier lessons' words that are due.
  const practiceIds = useMemo(
    () =>
      courseLessons.some((item) => item.id === sessionId)
        ? courseLessons.map((item) => item.id)
        : [sessionId],
    [courseLessons, sessionId],
  );
  const practice = usePracticeDue(practiceIds, sessionId);

  const write = () =>
    void requestLessonSheet(sessionId, model, { force: true });

  if (!lesson.isLesson) return null;
  const sheet = sheetDocument?.sheet ?? null;
  const courseName = lesson.folderPath.split("/").pop() || lesson.folderPath;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-1 pt-2 pb-16">
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
          <header className="flex flex-col gap-3">
            {sheet.topic ? (
              <p className="text-mirna-serra dark:text-mirna-moss text-xs font-semibold tracking-wider uppercase">
                {sheet.topic}
              </p>
            ) : null}
            <p className="font-brand text-xl leading-relaxed">
              {sheet.summary}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => setPractising(true)}
                disabled={practice.due === 0}
                title={
                  practice.fromOtherLessons > 0
                    ? t`Includes ${practice.fromOtherLessons} words from earlier lessons that are due again`
                    : undefined
                }
              >
                {practice.due > 0 ? (
                  <Trans>Practise {practice.due} words</Trans>
                ) : sheet.vocabulary.length > 0 ? (
                  <Trans>All practised for now</Trans>
                ) : (
                  <Trans>No words to practise</Trans>
                )}
              </Button>
              {practice.fromOtherLessons > 0 ? (
                <span className="text-muted-foreground text-xs">
                  <Trans>
                    incl. {practice.fromOtherLessons} from earlier lessons
                  </Trans>
                </span>
              ) : null}
              <ExportMenu
                sheet={sheet}
                lessonTitle={session?.title || t`Lesson`}
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
              {lesson.folderPath ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openCourse(lesson.folderPath)}
                >
                  <GraduationCap className="size-3.5" />
                  <Trans>{courseName} course</Trans>
                </Button>
              ) : null}
              {sheetDocument?.model ? (
                <span className="text-muted-foreground ml-auto text-xs">
                  <Trans>Written by {sheetDocument.model}</Trans>
                </span>
              ) : null}
            </div>
          </header>

          <Words sessionId={sessionId} sheet={sheet} />
          <Patterns sessionId={sessionId} sheet={sheet} />
          <Corrections sessionId={sessionId} sheet={sheet} />
          <Marks sessionId={sessionId} sheet={sheet} marks={marks} />
          <Homework sessionId={sessionId} sheet={sheet} />
          <Talk sessionId={sessionId} sheet={sheet} />
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
  return {
    canPlay: player.audioExists,
    playTerm: (term: string, aroundMs: number | null) => {
      const clip = pickTermClip(
        findTermOccurrences(segments, term, roleOf),
        aroundMs,
      );
      if (clip) player.playRange(clip.startMs / 1000, clip.endMs / 1000);
      else if (aroundMs !== null)
        player.playRange(aroundMs / 1000, aroundMs / 1000 + 4);
    },
    playFrom: (ms: number, seconds = 8) =>
      player.playRange(Math.max(0, ms - 500) / 1000, ms / 1000 + seconds),
  };
}

function PlayButton({
  label,
  time,
  onClick,
  disabled,
}: {
  label: string;
  time?: number | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-mirna-serra hover:bg-accent dark:text-mirna-moss inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium disabled:opacity-40"
    >
      <Play className="size-3" weight="bold" />
      {time !== undefined && time !== null ? (
        <span className="text-muted-foreground font-mono">
          {formatClock(time)}
        </span>
      ) : null}
    </button>
  );
}

function Words({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const { canPlay, playTerm } = usePlayAt(sessionId);
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
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Word</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Reading</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Meaning</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Teacher says it</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.vocabulary.map((item) => (
              <tr key={item.term} className="border-t">
                <td className="px-3 py-2 text-xl">
                  <LessonTerm term={item.term} />
                </td>
                <td className="px-3 py-2">{item.reading}</td>
                <td className="px-3 py-2">
                  {item.meaning}
                  {item.isNew ? null : (
                    <span className="bg-muted text-muted-foreground rounded-pill ml-2 px-2 py-0.5 text-[11px]">
                      <Trans>seen before</Trans>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <PlayButton
                    label={t`Play the teacher saying ${item.term}`}
                    time={item.heardAtMs}
                    disabled={!canPlay}
                    onClick={() => playTerm(item.term, item.heardAtMs)}
                  />
                </td>
              </tr>
            ))}
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
  const { canPlay, playFrom } = usePlayAt(sessionId);
  if (sheet.patterns.length === 0) return null;
  return (
    <Section title={<Trans>Patterns</Trans>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {sheet.patterns.map((pattern, index) => (
          <div
            key={`${pattern.pattern}-${index}`}
            className="flex flex-col gap-3 rounded-xl border p-4"
          >
            <div className="text-mirna-serra dark:text-mirna-moss font-semibold">
              <LessonTerm term={pattern.pattern} toneColours={false} />
            </div>
            {pattern.explanation ? (
              <p className="text-sm leading-relaxed">{pattern.explanation}</p>
            ) : null}
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
                    onClick={() => playFrom(example.atMs!)}
                  />
                ) : null}
              </div>
            ))}
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
  const { canPlay, playFrom } = usePlayAt(sessionId);
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
        {sheet.corrections.map((correction, index) => (
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
            {correction.atMs !== null ? (
              <PlayButton
                label={t`Play this moment`}
                time={correction.atMs}
                disabled={!canPlay}
                onClick={() => playFrom(correction.atMs!, 10)}
              />
            ) : (
              <span />
            )}
          </li>
        ))}
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
  const { canPlay, playFrom } = usePlayAt(sessionId);
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
  const add = useMutation({
    mutationFn: (item: { text: string; due: string }) =>
      addHomeworkTodo(sessionId, item),
    onError: () => toast.error(t`Couldn't add it to your to-dos.`),
  });
  if (sheet.homework.length === 0) return null;
  return (
    <Section title={<Trans>Homework</Trans>}>
      <ul className="flex flex-col gap-2">
        {sheet.homework.map((item, index) => {
          const isAdded = added.has(homeworkTodoId(sessionId, item.text));
          return (
            <li
              key={index}
              className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{item.text}</span>
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
              <Button
                size="sm"
                variant={isAdded ? "ghost" : "outline"}
                disabled={isAdded || add.isPending}
                onClick={() => add.mutate(item)}
              >
                {isAdded ? (
                  <>
                    <Check className="size-3.5" />
                    <Trans>In your to-dos</Trans>
                  </>
                ) : (
                  <Trans>Add to to-dos</Trans>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Talk({ sessionId, sheet }: { sessionId: string; sheet: LessonSheet }) {
  const { segments, roleOf, ready } = useLessonTranscript(sessionId);
  // Worked out from the transcript each time, so sheets written before the
  // speakers were sorted out still show the right share.
  const talk = useMemo(
    () => (ready ? computeTalkStats(segments, roleOf) : sheet.talk),
    [ready, roleOf, segments, sheet.talk],
  );
  const chinese = useMemo(
    () => (ready ? computeChineseStats(segments, roleOf) : null),
    [ready, roleOf, segments],
  );
  if (!talk && !chinese) return null;
  const share = talk
    ? Math.round((talk.studentMs / (talk.studentMs + talk.teacherMs)) * 100)
    : 0;
  const inChinese = chinese ? chineseShare(chinese) : 0;
  return (
    <Section title={<Trans>Who talked</Trans>}>
      <div className="flex flex-col gap-4 rounded-xl border p-4">
        {talk ? (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                <Trans>You spoke {share}% of the time</Trans>
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {formatClock(talk.studentMs)} / {formatClock(talk.teacherMs)}
              </span>
            </div>
            <div
              className="bg-muted rounded-pill flex h-2 overflow-hidden"
              aria-hidden="true"
            >
              <span
                className="bg-mirna-serra h-full"
                style={{ width: `${share}%` }}
              />
              <span className="h-full flex-1 bg-[#A9C1E0]" />
            </div>
          </div>
        ) : null}
        {chinese ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="font-medium">
                <Trans>{inChinese}% of the lesson was in Chinese</Trans>
              </span>
              {talk ? (
                <span className="text-muted-foreground text-xs">
                  <Trans>
                    You spoke Chinese for{" "}
                    {formatClock(chinese.studentChineseMs)}
                  </Trans>
                </span>
              ) : null}
            </div>
            <div
              className="bg-muted rounded-pill flex h-2 overflow-hidden"
              aria-hidden="true"
            >
              <span
                className="bg-mirna-terra h-full"
                style={{ width: `${inChinese}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function ExportMenu({
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <DownloadSimple className="size-3.5" />
          <Trans>Export words</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => run.mutate("anki")}>
          <Trans>For Anki (text file)</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run.mutate("pleco")}>
          <Trans>For Pleco (text file)</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
