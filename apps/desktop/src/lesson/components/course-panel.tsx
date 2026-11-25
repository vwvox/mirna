import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { DownloadSimple } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { toast } from "@anlg/ui/components/ui/toast";

import {
  buildCourseWords,
  type CourseLesson,
  courseProgress,
  practiceMinutes,
} from "../course-data";
import { exportVocabulary, type VocabularyExportFormat } from "../export";
import {
  courseHomework,
  setHomeworkDone,
  useHomeworkStatuses,
} from "../homework";
import { setLessonQuestionAsked, useCourseMarks } from "../marks";
import { dueCards } from "../practice";
import { usePracticeLessons } from "../practice-data";
import { useCourseLessons } from "../queries";
import { formatClock } from "../time";
import { useLessonTranscripts } from "../use-lesson-segments";
import { ProgressCard } from "./course-charts";
import { CourseWords } from "./course-words";
import { openNewLessonDialog } from "./new-lesson-dialog";
import { LessonPracticeDialog } from "./practice-dialog";
import { LessonTerm } from "./term";

import { ChineseDisplayMenu } from "~/session/components/note-input/transcript/display-menu";
import { useTabs } from "~/store/zustand/tabs";

const HERO_WORDS = 6;
const RECENT_LESSONS = 4;

function formatHours(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** The course view on a folder that holds lessons: what to do next, then progress. */
export function CoursePanel({ folderPath }: { folderPath: string }) {
  const { t } = useLingui();
  const rows = useCourseLessons(folderPath);
  const ids = useMemo(() => rows.map((lesson) => lesson.id), [rows]);
  const practiceLessons = usePracticeLessons(ids);
  const marks = useCourseMarks(ids);
  const transcripts = useLessonTranscripts(ids);
  const homeworkStatuses = useHomeworkStatuses(ids);
  const openSession = useTabs((state) => state.openNew);
  const [practising, setPractising] = useState<null | {
    terms?: string[];
    title: string;
  }>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const courseName = folderPath.split("/").pop() || folderPath;

  // Oldest first, numbered as the course's lessons.
  const lessons = useMemo<CourseLesson[]>(() => {
    const byId = new Map(
      practiceLessons.map((lesson) => [lesson.sessionId, lesson]),
    );
    return [...rows].reverse().map((row, index) => {
      const documents = byId.get(row.id);
      return {
        sessionId: row.id,
        title: row.title,
        started: row.started_at || row.created_at,
        sheet: documents?.sheet ?? null,
        practice: documents?.practice ?? null,
        number: index + 1,
        audioMs: Number(row.audio_ms ?? 0),
        transcript: transcripts.get(row.id) ?? null,
        marks: marks.get(row.id) ?? null,
      };
    });
  }, [marks, practiceLessons, rows, transcripts]);

  const words = useMemo(() => buildCourseWords(lessons), [lessons]);
  const progress = useMemo(() => courseProgress(lessons), [lessons]);
  const due = useMemo(
    () =>
      dueCards(
        words.map((word) => word.card),
        new Date(),
      ),
    [words],
  );
  const hard = due.filter((card) => (card.state?.lapses ?? 0) >= 2);
  const meaningOf = useMemo(
    () => new Map(words.map((word) => [word.term, word.meaning])),
    [words],
  );

  const homework = useMemo(
    () =>
      courseHomework(
        [...lessons].reverse().map((lesson) => ({
          sessionId: lesson.sessionId,
          title: lesson.sheet?.sheet.topic || lesson.title,
          homework: lesson.sheet?.sheet.homework ?? [],
        })),
        homeworkStatuses,
      ).filter((item) => !item.done),
    [homeworkStatuses, lessons],
  );
  const questions = useMemo(
    () =>
      [...lessons]
        .reverse()
        .flatMap((lesson) =>
          (lesson.marks?.questions ?? [])
            .filter((question) => !question.asked)
            .map((question) => ({ lesson, question })),
        ),
    [lessons],
  );

  const recurring = useMemo(
    () =>
      words
        .filter((word) => word.lessonCount > 1)
        .sort((a, b) => b.lessonCount - a.lessonCount || b.said - a.said)
        .slice(0, 8),
    [words],
  );
  const missed = useMemo(
    () =>
      words
        .filter((word) => word.lapses >= 2)
        .sort((a, b) => b.lapses - a.lapses)
        .slice(0, 8),
    [words],
  );

  const tick = useMutation({
    mutationFn: ({
      item,
      done,
    }: {
      item: (typeof homework)[number];
      done: boolean;
    }) => setHomeworkDone(item.sessionId, item, done),
    onError: () => toast.error(t`Couldn't update the homework.`),
  });

  const exportWords = useMutation({
    mutationFn: (format: VocabularyExportFormat) =>
      exportVocabulary(
        format,
        words.map((word) => ({
          ...word.card.item,
          lesson:
            lessons.find((lesson) => lesson.sessionId === word.card.sessionId)
              ?.title ?? "",
        })),
        courseName,
      ),
    onSuccess: (path) => {
      if (path) toast.success(t`Saved ${path}`);
    },
    onError: () => toast.error(t`Couldn't save the file.`),
  });

  if (rows.length === 0) return null;

  const latest = progress[progress.length - 1];
  const firstWithChinese = progress.find((item) => item.chinese !== null);
  const totalMs = lessons.reduce((sum, lesson) => sum + lesson.audioMs, 0);
  const since = new Date(lessons[0]!.started).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
  const newestFirst = [...lessons].reverse();
  const shownLessons = showEarlier
    ? newestFirst
    : newestFirst.slice(0, RECENT_LESSONS);
  const progressById = new Map(progress.map((item) => [item.sessionId, item]));

  const openLesson = (sessionId: string) =>
    openSession({
      type: "sessions",
      id: sessionId,
      state: {
        view: { type: "lesson" },
        autoStart: false,
        scheduledAutoStart: null,
      },
    });

  return (
    <section aria-label={t`Course`} className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <Trans>Course</Trans>
          </span>
          <h1 className="font-brand text-3xl font-medium">{courseName}</h1>
          <p className="text-muted-foreground text-sm">
            {lessons.length === 1 ? (
              <Trans>1 lesson</Trans>
            ) : (
              <Trans>{lessons.length} lessons</Trans>
            )}{" "}
            · <Trans>since {since}</Trans>
            {totalMs >= 60_000 ? (
              <>
                {" "}
                · <Trans>{formatHours(totalMs)} recorded</Trans>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChineseDisplayMenu
            lesson
            label={t`Pinyin and tones`}
            triggerClassName="h-8 px-3 text-sm"
          />
          {words.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <DownloadSimple className="size-3.5" />
                  <Trans>Export words</Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportWords.mutate("anki")}>
                  <Trans>For Anki (text file)</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportWords.mutate("pleco")}>
                  <Trans>For Pleco (text file)</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button size="sm" onClick={() => openNewLessonDialog(folderPath)}>
            <Trans>Start lesson {lessons.length + 1}</Trans>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section
          aria-label={t`Practise`}
          className="bg-mirna-serra text-mirna-paper flex flex-col gap-3 rounded-2xl p-6"
        >
          <span className="text-mirna-moss/80 text-xs font-semibold tracking-wider uppercase">
            <Trans>Practise</Trans>
          </span>
          <p className="font-brand text-3xl leading-tight font-medium">
            {due.length > 0 ? (
              <Trans>{due.length} words due</Trans>
            ) : words.length > 0 ? (
              <Trans>All caught up</Trans>
            ) : (
              <Trans>No words yet</Trans>
            )}
          </p>
          <p className="text-mirna-moss text-sm">
            {due.length > 0 ? (
              <>
                <Trans>About {practiceMinutes(due.length)} minutes.</Trans>{" "}
                {hard.length > 0 ? (
                  <Trans>
                    {hard.length} of them are words you keep missing.
                  </Trans>
                ) : null}
              </>
            ) : words.length > 0 ? (
              <Trans>Words come back here when they're due again.</Trans>
            ) : (
              <Trans>Words arrive with each lesson's study sheet.</Trans>
            )}
          </p>
          {due.length > 0 ? (
            <ul
              aria-label={t`Some of the words due now`}
              className="flex flex-wrap gap-2"
            >
              {due.slice(0, HERO_WORDS).map((card) => (
                <li
                  key={card.id}
                  className="flex items-end gap-2 rounded-lg bg-white/10 px-2.5 py-1.5"
                >
                  <LessonTerm
                    term={card.item.term}
                    reading={card.item.reading}
                    className="text-lg leading-none"
                  />
                  <span className="text-mirna-moss pb-0.5 text-xs">
                    {meaningOf.get(card.id)}
                  </span>
                </li>
              ))}
              {due.length > HERO_WORDS ? (
                <li className="text-mirna-moss flex items-center rounded-lg border border-white/20 px-2.5 py-1.5 text-xs">
                  <Trans>+{due.length - HERO_WORDS} more</Trans>
                </li>
              ) : null}
            </ul>
          ) : null}
          {due.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="bg-mirna-ipe hover:bg-mirna-ipe/90 text-mirna-soapstone"
                onClick={() => setPractising({ title: courseName })}
              >
                <Trans>Practise {due.length} words</Trans>
              </Button>
              {hard.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-mirna-paper border-white/30 bg-transparent hover:bg-white/10"
                  onClick={() =>
                    setPractising({
                      terms: hard.map((card) => card.id),
                      title: t`Words you keep missing`,
                    })
                  }
                >
                  <Trans>Only the {hard.length} hard ones</Trans>
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section
          aria-label={t`Before the next class`}
          className="bg-mirna-mist/60 dark:bg-card flex flex-col gap-4 rounded-2xl border p-5"
        >
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <Trans>Before the next class</Trans>
          </span>
          {questions.length === 0 && homework.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <Trans>
                Nothing waiting. Questions you save during class and homework
                from study sheets show up here.
              </Trans>
            </p>
          ) : null}
          {questions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                <Trans>Ask your teacher</Trans>
              </h3>
              {questions.map(({ lesson, question }) => (
                <label
                  key={question.id}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="accent-mirna-serra mt-0.5 size-4"
                    onChange={(event) =>
                      void setLessonQuestionAsked(
                        lesson.sessionId,
                        question.id,
                        event.target.checked,
                      )
                    }
                  />
                  <span className="flex flex-col">
                    <span>{question.text}</span>
                    <small className="text-muted-foreground text-xs">
                      <Trans>From lesson {lesson.number}</Trans>
                      {question.atMs !== null
                        ? ` · ${formatClock(question.atMs)}`
                        : ""}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {homework.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                <Trans>Homework</Trans>
              </h3>
              {homework.map((item) => (
                <label
                  key={`${item.sessionId}-${item.text}`}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="accent-mirna-serra mt-0.5 size-4"
                    aria-label={t`Done: ${item.text}`}
                    disabled={tick.isPending}
                    onChange={(event) =>
                      tick.mutate({ item, done: event.target.checked })
                    }
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{item.text}</span>
                    <small className="text-muted-foreground text-xs">
                      <Trans>Set in {item.lessonTitle}</Trans>
                    </small>
                  </span>
                  {item.due ? (
                    <span className="text-mirna-terra rounded-pill bg-orange-50 px-2 py-0.5 text-xs font-semibold dark:bg-orange-950/40">
                      {item.due}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ProgressCard
          title={t`Words collected`}
          value={String(latest?.wordsCollected ?? 0)}
          detail={
            latest && latest.newWords > 0
              ? t`${latest.newWords} from the last lesson`
              : undefined
          }
          chart={{
            kind: "line",
            values: progress.map((item) => item.wordsCollected),
            label: t`Words collected after each lesson`,
          }}
        />
        <ProgressCard
          title={t`Lesson in Chinese`}
          value={latest?.chinese != null ? `${latest.chinese}%` : "–"}
          detail={
            firstWithChinese &&
            latest?.chinese != null &&
            firstWithChinese !== latest
              ? t`from ${firstWithChinese.chinese}% in lesson ${firstWithChinese.number}`
              : undefined
          }
          chart={{
            kind: "bars",
            tone: "terra",
            values: progress.map((item) => item.chinese),
            label: t`Share of each lesson in Chinese`,
          }}
        />
        <ProgressCard
          title={t`You spoke`}
          value={latest?.spoke != null ? `${latest.spoke}%` : "–"}
          detail={
            latest?.spoke != null
              ? t`teacher ${100 - latest.spoke}%`
              : t`voices not told apart`
          }
          chart={{
            kind: "bars",
            tone: "serra",
            values: progress.map((item) => item.spoke),
            label: t`Your share of speaking time in each lesson`,
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="course-lessons"
          className="flex flex-col gap-2"
        >
          <h2
            id="course-lessons"
            className="font-brand flex items-baseline gap-2 text-lg font-medium"
          >
            <Trans>Lessons</Trans>
            <span className="text-muted-foreground font-sans text-sm font-normal">
              {lessons.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {shownLessons.map((lesson) => {
              const stats = progressById.get(lesson.sessionId);
              const date = new Date(lesson.started);
              const topic = lesson.sheet?.sheet.topic;
              return (
                <li key={lesson.sessionId}>
                  <button
                    type="button"
                    onClick={() => openLesson(lesson.sessionId)}
                    className="hover:bg-accent flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left"
                  >
                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold">
                      {lesson.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {topic || lesson.title || t`Untitled lesson`}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {date.toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {lesson.audioMs >= 1000
                          ? ` · ${formatClock(lesson.audioMs)}`
                          : ""}
                        {stats?.spoke != null
                          ? ` · ${t`you spoke ${stats.spoke}%`}`
                          : ""}
                        {stats?.chinese != null
                          ? ` · ${t`${stats.chinese}% in Chinese`}`
                          : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {lesson.sheet ? (
                        <span className="bg-mirna-moss text-mirna-serra rounded-pill px-2 py-0.5 text-[11px] font-semibold">
                          <Trans>{stats?.newWords ?? 0} new words</Trans>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">
                          <Trans>No study sheet yet</Trans>
                        </span>
                      )}
                      {stats && stats.openQuestions > 0 ? (
                        <span className="text-mirna-terra text-[11px] font-semibold">
                          {stats.openQuestions === 1 ? (
                            <Trans>1 open question</Trans>
                          ) : (
                            <Trans>{stats.openQuestions} open questions</Trans>
                          )}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {lessons.length > RECENT_LESSONS ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setShowEarlier((value) => !value)}
            >
              {showEarlier ? (
                <Trans>Show fewer</Trans>
              ) : (
                <Trans>
                  Show {lessons.length - RECENT_LESSONS} earlier lessons
                </Trans>
              )}
            </Button>
          ) : null}
        </section>

        {recurring.length > 0 || missed.length > 0 ? (
          <section
            aria-labelledby="course-recurring"
            className="bg-mirna-mist/60 dark:bg-card flex flex-col gap-3 self-start rounded-2xl border p-4"
          >
            <h2
              id="course-recurring"
              className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
            >
              <Trans>Keeps coming up</Trans>
            </h2>
            {recurring.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {recurring.map((word) => (
                  <li
                    key={word.term}
                    className="bg-background flex items-end gap-1.5 rounded-lg border px-2.5 py-1 text-sm"
                  >
                    <LessonTerm term={word.term} reading={word.reading} />
                    <span className="text-muted-foreground font-mono text-[11px]">
                      <Trans>{word.lessonCount} lessons</Trans>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {missed.length > 0 ? (
              <>
                <h3 className="text-sm font-semibold">
                  <Trans>Words you keep missing</Trans>
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {missed.map((word) => (
                    <li
                      key={word.term}
                      className="bg-background rounded-lg border px-2.5 py-1 text-sm"
                    >
                      <LessonTerm term={word.term} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      <CourseWords words={words} lessons={lessons} />

      {practising ? (
        <LessonPracticeDialog
          sessionIds={ids}
          terms={practising.terms}
          title={practising.title}
          onClose={() => setPractising(null)}
        />
      ) : null}
    </section>
  );
}
