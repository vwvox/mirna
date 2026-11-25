import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { BookOpen, Flag, Star, X } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import {
  addLessonMark,
  addLessonQuestion,
  removeLessonMark,
  setLessonQuestionAsked,
  updateLessonMarkNote,
  useLessonMarks,
} from "../marks";
import { useLessonSession, useLessonSheet } from "../queries";
import { useMarkShortcutLabels } from "../shortcut-labels";
import { formatClock } from "../time";
import {
  LESSON_MARK_KINDS,
  type LessonMark,
  type LessonMarkKind,
} from "../types";
import { usePreviousLesson } from "../use-previous-lesson";
import { useMarkLabels } from "./study-sheet";
import { TalkStrip } from "./talk-strip";

const MARK_ICONS: Record<LessonMarkKind, typeof Star> = {
  important: Star,
  confused: Flag,
  homework: BookOpen,
};

const MARK_TONES: Record<LessonMarkKind, string> = {
  important: "text-amber-700 dark:text-amber-300",
  confused: "text-mirna-terra",
  homework: "text-mirna-serra dark:text-mirna-moss",
};

export function LessonBoard({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const labels = useMarkLabels();
  const marks = useLessonMarks(sessionId);
  const shortcutLabels = useMarkShortcutLabels((state) => state.labels);
  const [question, setQuestion] = useState("");

  return (
    <aside
      aria-label={t`Lesson board`}
      className="bg-mirna-mist/60 dark:bg-card flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l px-4 pt-4 pb-10"
    >
      <section className="flex flex-col gap-2">
        <BoardHeading>
          <Trans>Mark this moment</Trans>
        </BoardHeading>
        {(["important", "confused", "homework"] as const).map((kind) => {
          const Icon = MARK_ICONS[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => void addLessonMark(sessionId, kind)}
              className="bg-background hover:bg-accent flex h-11 items-center gap-3 rounded-lg border px-3 text-left text-sm font-semibold"
            >
              <Icon className={cn(["size-4", MARK_TONES[kind]])} />
              {kind === "confused" ? t`I didn't get this` : labels[kind]}
              <kbd className="text-muted-foreground bg-muted ml-auto rounded border px-1.5 font-mono text-[11px] font-medium">
                {shortcutLabels[LESSON_MARK_KINDS.indexOf(kind)]}
              </kbd>
            </button>
          );
        })}
        <form
          className="mt-1 flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void addLessonQuestion(sessionId, question);
            setQuestion("");
          }}
        >
          <label
            htmlFor={`lesson-question-${sessionId}`}
            className="text-muted-foreground text-xs"
          >
            <Trans>Question for after class</Trans>
          </label>
          <input
            id={`lesson-question-${sessionId}`}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t`Type it now, ask it later…`}
            className="bg-background h-9 rounded-lg border px-3 text-sm"
          />
        </form>
      </section>

      {marks.marks.length > 0 || marks.questions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <BoardHeading count={marks.marks.length + marks.questions.length}>
            <Trans>Marked</Trans>
          </BoardHeading>
          <ul className="flex flex-col gap-2">
            {marks.marks.map((mark) => (
              <MarkRow key={mark.id} sessionId={sessionId} mark={mark} />
            ))}
            {marks.questions.map((item) => (
              <li
                key={item.id}
                className="bg-background rounded-lg border px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground mr-2 text-xs">
                  <Trans>Ask later:</Trans>
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PreviousLesson sessionId={sessionId} />

      <section className="flex flex-col gap-2">
        <BoardHeading>
          <Trans>Who's talking</Trans>
        </BoardHeading>
        <TalkStrip sessionId={sessionId} />
      </section>

      <p className="text-muted-foreground text-xs leading-relaxed">
        <Trans>
          Words, patterns, corrections and homework come after class: when you
          stop, Mirna transcribes the lesson on this Mac, then the AI picked in
          Intelligence writes the study sheet.
        </Trans>
      </p>
    </aside>
  );
}

function BoardHeading({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <h3 className="text-muted-foreground flex items-center text-[11px] font-semibold tracking-wider uppercase">
      {children}
      {count !== undefined ? (
        <span className="ml-auto font-mono tracking-normal normal-case">
          {count}
        </span>
      ) : null}
    </h3>
  );
}

function MarkRow({ sessionId, mark }: { sessionId: string; mark: LessonMark }) {
  const { t } = useLingui();
  const labels = useMarkLabels();
  const [note, setNote] = useState(mark.note);
  useEffect(() => setNote(mark.note), [mark.note]);
  const Icon = MARK_ICONS[mark.kind];
  return (
    <li className="bg-background flex flex-col gap-1.5 rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground font-mono">
          {formatClock(mark.atMs)}
        </span>
        <Icon className={cn(["size-3.5", MARK_TONES[mark.kind]])} />
        <span className="font-semibold">{labels[mark.kind]}</span>
        <button
          type="button"
          aria-label={t`Remove this mark`}
          onClick={() => void removeLessonMark(sessionId, mark.id)}
          className="text-muted-foreground hover:text-foreground ml-auto"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <input
        value={note}
        aria-label={t`Note for this mark`}
        placeholder={t`Add a word about it`}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (note !== mark.note)
            void updateLessonMarkNote(sessionId, mark.id, note.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="bg-muted/40 h-7 rounded-md px-2 text-sm"
      />
    </li>
  );
}

function PreviousLesson({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const lesson = useLessonSession(sessionId);
  const previous = usePreviousLesson(sessionId, lesson.folderPath);
  const previousMarks = useLessonMarks(previous?.id);
  const previousSheet = useLessonSheet(previous?.id);
  if (!previous) return null;
  const questions = previousMarks.questions.filter((item) => !item.asked);
  const unanswered = previousSheet?.sheet.openQuestions ?? [];
  const homework = previousSheet?.sheet.homework ?? [];
  if (questions.length + unanswered.length + homework.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <BoardHeading>
        <Trans>From {previous.title || t`the last lesson`}</Trans>
      </BoardHeading>
      <ul className="bg-background flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm">
        {questions.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="accent-mirna-serra mt-0.5 size-4"
              aria-label={t`Asked`}
              onChange={(event) =>
                void setLessonQuestionAsked(
                  previous.id,
                  item.id,
                  event.target.checked,
                )
              }
            />
            <span>
              <b className="font-semibold">
                <Trans>Ask:</Trans>
              </b>{" "}
              {item.text}
            </span>
          </li>
        ))}
        {unanswered.map((text, index) => (
          <li key={`open-${index}`}>
            <b className="font-semibold">
              <Trans>Still open:</Trans>
            </b>{" "}
            {text}
          </li>
        ))}
        {homework.map((item, index) => (
          <li key={`hw-${index}`}>
            <b className="font-semibold">
              <Trans>Homework:</Trans>
            </b>{" "}
            {item.text}
            {item.due ? (
              <span className="text-muted-foreground"> · {item.due}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
