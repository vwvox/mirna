import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { DownloadSimple, GraduationCap } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { exportVocabulary, type VocabularyExportFormat } from "../export";
import { computeTalkStats } from "../generate";
import {
  courseHomework,
  setHomeworkDone,
  useHomeworkStatuses,
} from "../homework";
import { chineseShare, computeChineseStats } from "../language";
import { setLessonQuestionAsked } from "../marks";
import { dueCards } from "../practice";
import { practiceCardsOf, usePracticeLessons } from "../practice-data";
import { useCourseLessons } from "../queries";
import { parseLessonMarks } from "../schema";
import { formatClock } from "../time";
import type { LessonMarksDocument } from "../types";
import { useLessonTranscript } from "../use-lesson-segments";
import { openNewLessonDialog } from "./new-lesson-dialog";
import { LessonPracticeDialog } from "./practice-dialog";
import { LessonTerm } from "./term";

import { useLiveQuery } from "~/db";
import { useTabs } from "~/store/zustand/tabs";

type MarksRow = { session_id: string; body: string };

function useCourseMarks(sessionIds: string[]) {
  const placeholders = sessionIds.map(() => "?").join(", ");
  const { data = EMPTY_MARKS } = useLiveQuery<
    MarksRow,
    Map<string, LessonMarksDocument>
  >({
    sql: `
      SELECT session_id, body FROM session_documents
      WHERE session_id IN (${placeholders || "''"})
        AND kind = 'lesson_marks' AND deleted_at IS NULL
    `,
    params: sessionIds,
    enabled: sessionIds.length > 0,
    mapRows: (rows) => {
      const marks = new Map<string, LessonMarksDocument>();
      for (const row of rows) {
        try {
          const parsed = parseLessonMarks(JSON.parse(row.body));
          if (parsed) marks.set(row.session_id, parsed);
        } catch {
          // Leave out marks that can't be read.
        }
      }
      return marks;
    },
  });
  return data;
}

const EMPTY_MARKS = new Map<string, LessonMarksDocument>();

/** The course view on a folder that holds lessons. */
export function CoursePanel({ folderPath }: { folderPath: string }) {
  const { t } = useLingui();
  const lessons = useCourseLessons(folderPath);
  const ids = useMemo(() => lessons.map((lesson) => lesson.id), [lessons]);
  const practiceLessons = usePracticeLessons(ids);
  const marks = useCourseMarks(ids);
  const homeworkStatuses = useHomeworkStatuses(ids);
  const latest = useLessonTranscript(ids[0]);
  const openSession = useTabs((state) => state.openNew);
  const [practising, setPractising] = useState(false);

  const cards = useMemo(
    () => practiceCardsOf(practiceLessons),
    [practiceLessons],
  );
  const due = useMemo(() => dueCards(cards, new Date()).length, [cards]);
  const sheets = useMemo(
    () =>
      new Map(
        practiceLessons
          .filter((lesson) => lesson.sheet)
          .map((lesson) => [lesson.sessionId, lesson.sheet!.sheet]),
      ),
    [practiceLessons],
  );

  const recurring = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sheet of sheets.values()) {
      for (const item of sheet.vocabulary)
        counts.set(item.term, (counts.get(item.term) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [sheets]);

  const missed = useMemo(
    () =>
      cards
        .filter((card) => (card.state?.lapses ?? 0) >= 2)
        .sort((a, b) => (b.state?.lapses ?? 0) - (a.state?.lapses ?? 0))
        .slice(0, 8),
    [cards],
  );

  const questions = useMemo(
    () =>
      ids.flatMap((id) =>
        (marks.get(id)?.questions ?? [])
          .filter((question) => !question.asked)
          .map((question) => ({ sessionId: id, question })),
      ),
    [ids, marks],
  );

  // The latest lesson, worked out from its transcript like its study sheet does.
  const lastTalk = useMemo(
    () =>
      latest.ready
        ? computeTalkStats(latest.segments, latest.roleOf)
        : (sheets.get(ids[0] ?? "")?.talk ?? null),
    [ids, latest.ready, latest.roleOf, latest.segments, sheets],
  );
  const lastChinese = useMemo(
    () =>
      latest.ready ? computeChineseStats(latest.segments, latest.roleOf) : null,
    [latest.ready, latest.roleOf, latest.segments],
  );

  const homework = useMemo(
    () =>
      courseHomework(
        practiceLessons.map((lesson) => ({
          sessionId: lesson.sessionId,
          title: lesson.title,
          homework: lesson.sheet?.sheet.homework ?? [],
        })),
        homeworkStatuses,
      ),
    [homeworkStatuses, practiceLessons],
  );
  const openHomework = homework.filter((item) => !item.done).length;
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

  const allWords = useMemo(() => {
    const seen = new Set<string>();
    return practiceLessons.flatMap((lesson) =>
      (lesson.sheet?.sheet.vocabulary ?? [])
        .filter((item) => !seen.has(item.term) && seen.add(item.term))
        .map((item) => ({ ...item, lesson: lesson.title })),
    );
  }, [practiceLessons]);

  const exportWords = useMutation({
    mutationFn: (format: VocabularyExportFormat) =>
      exportVocabulary(
        format,
        allWords,
        folderPath.split("/").pop() ?? folderPath,
      ),
    onSuccess: (path) => {
      if (path) toast.success(t`Saved ${path}`);
    },
    onError: () => toast.error(t`Couldn't save the file.`),
  });

  if (lessons.length === 0) return null;

  const share = lastTalk
    ? Math.round(
        (lastTalk.studentMs / (lastTalk.studentMs + lastTalk.teacherMs)) * 100,
      )
    : null;

  return (
    <section aria-label={t`Course`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="text-mirna-serra size-5" />
        <h3 className="font-brand text-xl font-medium">
          <Trans>Course</Trans>
        </h3>
        <span className="text-muted-foreground text-sm">
          {lessons.length === 1 ? (
            <Trans>1 lesson</Trans>
          ) : (
            <Trans>{lessons.length} lessons</Trans>
          )}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {allWords.length > 0 ? (
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
          <Button
            size="sm"
            variant="outline"
            disabled={cards.length === 0}
            onClick={() => setPractising(true)}
          >
            <Trans>Practise {due}</Trans>
          </Button>
          <Button size="sm" onClick={() => openNewLessonDialog(folderPath)}>
            <Trans>Start lesson {lessons.length + 1}</Trans>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label={t`Words collected`} value={String(allWords.length)} />
        <Tile label={t`Due to practise`} value={String(due)} />
        <Tile label={t`Homework open`} value={String(openHomework)} />
        <Tile
          label={t`You spoke, last lesson`}
          value={share === null ? "–" : `${share}%`}
        />
        <Tile
          label={t`In Chinese, last lesson`}
          value={lastChinese ? `${chineseShare(lastChinese)}%` : "–"}
        />
      </div>

      {recurring.length > 0 || missed.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {recurring.length > 0 ? (
            <Panel title={t`Keeps coming up`}>
              <ul className="flex flex-wrap gap-2">
                {recurring.map(([term, count]) => (
                  <li
                    key={term}
                    className="bg-background rounded-lg border px-2.5 py-1 text-sm"
                  >
                    <LessonTerm term={term} />{" "}
                    <span className="text-muted-foreground font-mono text-[11px]">
                      ×{count}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {missed.length > 0 ? (
            <Panel title={t`Words you keep missing`}>
              <ul className="flex flex-wrap gap-2">
                {missed.map((card) => (
                  <li
                    key={`${card.sessionId}-${card.id}`}
                    className="bg-background rounded-lg border px-2.5 py-1 text-sm"
                  >
                    <LessonTerm term={card.item.term} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {homework.length > 0 ? (
        <Panel title={t`Homework`}>
          <ul className="flex flex-col gap-2">
            {homework.map((item) => (
              <li
                key={`${item.sessionId}-${item.text}`}
                className="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-mirna-serra mt-0.5 size-4"
                  aria-label={t`Done: ${item.text}`}
                  checked={item.done}
                  disabled={tick.isPending}
                  onChange={(event) =>
                    tick.mutate({ item, done: event.target.checked })
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn([
                      item.done && "text-muted-foreground line-through",
                    ])}
                  >
                    {item.text}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {item.lessonTitle || t`Untitled lesson`}
                  </span>
                </span>
                {item.due && !item.done ? (
                  <span className="text-mirna-terra rounded-pill bg-orange-50 px-2 py-0.5 text-xs font-semibold dark:bg-orange-950/40">
                    {item.due}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {questions.length > 0 ? (
        <Panel title={t`Questions for the next class`}>
          <ul className="flex flex-col gap-2">
            {questions.map(({ sessionId, question }) => (
              <li key={question.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-mirna-serra mt-0.5 size-4"
                  aria-label={t`Asked`}
                  onChange={(event) =>
                    void setLessonQuestionAsked(
                      sessionId,
                      question.id,
                      event.target.checked,
                    )
                  }
                />
                <span>{question.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">
          <Trans>Lessons</Trans>
        </h4>
        <ul className="flex flex-col gap-2">
          {lessons.map((lesson) => {
            const sheet = sheets.get(lesson.id);
            const date = new Date(lesson.started_at || lesson.created_at);
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() =>
                    openSession({
                      type: "sessions",
                      id: lesson.id,
                      state: {
                        view: { type: "lesson" },
                        autoStart: false,
                        scheduledAutoStart: null,
                      },
                    })
                  }
                  className="hover:bg-accent flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {lesson.title || t`Untitled lesson`}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {date.toLocaleDateString()}
                      {Number(lesson.audio_ms ?? 0) >= 1000
                        ? ` · ${formatClock(Number(lesson.audio_ms))}`
                        : ""}
                    </span>
                  </span>
                  {sheet ? (
                    <span className="bg-mirna-moss text-mirna-serra rounded-pill px-2 py-0.5 text-[11px] font-semibold">
                      <Trans>{sheet.vocabulary.length} words</Trans>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">
                      <Trans>No study sheet yet</Trans>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {practising ? (
        <LessonPracticeDialog
          sessionIds={ids}
          title={folderPath.split("/").pop() ?? folderPath}
          onClose={() => setPractising(false)}
        />
      ) : null}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border px-3 py-2.5">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="font-brand text-mirna-serra dark:text-mirna-moss text-2xl leading-none font-medium">
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-mirna-mist/60 dark:bg-card flex flex-col gap-2 rounded-xl border p-3">
      <h4 className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </h4>
      {children}
    </div>
  );
}
