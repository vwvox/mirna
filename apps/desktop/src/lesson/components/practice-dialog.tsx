import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";

import { Microphone, Play, Square } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { cn } from "@anlg/utils";

import { playSessionClip, sessionAudioUrl, stopClip } from "../clip-player";
import { findTermOccurrences, pickTermClip } from "../clips";
import {
  samplePlayedClip,
  startMicPitch,
  toRelativeContour,
  trimSilence,
  type MicRecording,
} from "../pitch";
import {
  describeNext,
  dueCards,
  recordPracticeGrade,
  type PracticeCard,
  type PracticeGrade,
} from "../practice";
import { practiceCardsFor, usePracticeLessons } from "../practice-data";
import { useLessonTranscript } from "../use-lesson-segments";
import { PitchChart } from "./pitch-chart";
import { LessonTerm } from "./term";

const GRADES: PracticeGrade[] = ["again", "hard", "good", "easy"];

function cardKey(card: Pick<PracticeCard, "sessionId" | "id">) {
  return `${card.sessionId}\u0000${card.id}`;
}

export function LessonPracticeDialog({
  sessionIds,
  focusSessionId,
  title,
  onClose,
}: {
  sessionIds: string[];
  /** Practise from this lesson's sheet: its words plus earlier words due again. */
  focusSessionId?: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const lessons = usePracticeLessons(sessionIds);
  const cards = useMemo(
    () => practiceCardsFor(lessons, focusSessionId),
    [focusSessionId, lessons],
  );
  const byKey = useMemo(
    () => new Map(cards.map((card) => [cardKey(card), card])),
    [cards],
  );
  const [queue, setQueue] = useState<string[] | null>(null);
  const [total, setTotal] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (queue !== null || lessons.length === 0) return;
    const due = dueCards(cards, new Date()).map(cardKey);
    setQueue(due);
    setTotal(due.length);
  }, [cards, lessons.length, queue]);

  useEffect(() => () => stopClip(), []);

  const current = queue && queue.length > 0 ? byKey.get(queue[0]!) : undefined;
  const titles = useMemo(
    () => new Map(lessons.map((lesson) => [lesson.sessionId, lesson.title])),
    [lessons],
  );

  const grade = (value: PracticeGrade) => {
    if (!current || !queue) return;
    const comesBackSoon =
      value === "again" || (value === "hard" && !current.state);
    void recordPracticeGrade(current, value);
    stopClip();
    setRevealed(false);
    setQueue(comesBackSoon ? [...queue.slice(1), queue[0]!] : queue.slice(1));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === " " && !revealed && current) {
      event.preventDefault();
      setRevealed(true);
    } else if (revealed && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      grade(GRADES[Number(event.key) - 1]!);
    }
  };

  const done = total - (queue?.length ?? 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-1">
          <DialogTitle className="font-brand text-2xl font-medium">
            <Trans>Practise</Trans>
          </DialogTitle>
          <DialogDescription>
            {total > 0 ? (
              <Trans>
                {title} · {Math.min(done + 1, total)} of {total}
              </Trans>
            ) : (
              title
            )}
          </DialogDescription>
        </div>
        {total > 0 ? (
          <div
            className="bg-muted rounded-pill h-1.5 overflow-hidden"
            aria-hidden="true"
          >
            <div
              className="bg-mirna-serra h-full transition-[width]"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
        ) : null}

        {queue === null ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            <Trans>Loading your words…</Trans>
          </p>
        ) : !current ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-brand text-xl">
              {total > 0 ? (
                <Trans>All done for now</Trans>
              ) : (
                <Trans>Nothing to practise yet</Trans>
              )}
            </p>
            <p className="text-muted-foreground max-w-sm text-sm">
              {total > 0 ? (
                <Trans>The words come back when they're due.</Trans>
              ) : (
                <Trans>
                  Words appear here once a lesson's study sheet is written.
                </Trans>
              )}
            </p>
            <Button onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </div>
        ) : (
          <PracticeCardView
            key={cardKey(current)}
            card={current}
            lessonTitle={titles.get(current.sessionId) ?? ""}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
          />
        )}

        {current && revealed ? (
          <div
            className="grid grid-cols-4 gap-2"
            role="group"
            aria-label={t`How did it go?`}
          >
            {GRADES.map((value, index) => (
              <button
                key={value}
                type="button"
                onClick={() => grade(value)}
                className="hover:bg-accent flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold"
              >
                {
                  {
                    again: t`Again`,
                    hard: t`Hard`,
                    good: t`Good`,
                    easy: t`Easy`,
                  }[value]
                }
                <span className="text-muted-foreground font-mono text-[11px] font-normal">
                  {index + 1} · {describeNext(current.state, value, new Date())}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PracticeCardView({
  card,
  lessonTitle,
  revealed,
  onReveal,
}: {
  card: PracticeCard;
  lessonTitle: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const { segments, roleOf } = useLessonTranscript(card.sessionId);
  const clip = useMemo(
    () =>
      pickTermClip(
        findTermOccurrences(segments, card.item.term, roleOf),
        card.item.heardAtMs,
      ),
    [card.item.heardAtMs, card.item.term, roleOf, segments],
  );

  return (
    <div className="flex flex-col gap-5 rounded-2xl border p-6">
      <div className="flex flex-wrap items-end gap-6">
        <LessonTerm
          term={card.item.term}
          toneColours={revealed}
          className="text-6xl leading-none font-medium tracking-wide"
        />
        {revealed ? (
          <div className="flex flex-col gap-1 pb-1">
            {card.item.reading ? (
              <span className="text-2xl font-medium">{card.item.reading}</span>
            ) : null}
            <span className="text-muted-foreground">{card.item.meaning}</span>
            {lessonTitle ? (
              <span className="text-muted-foreground text-xs">
                {lessonTitle}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!clip}
          onClick={() => {
            if (clip)
              void playSessionClip(card.sessionId, clip.startMs, clip.endMs);
          }}
        >
          <Play className="size-3.5" weight="bold" />
          <Trans>Teacher</Trans>
        </Button>
        <Button
          variant="outline"
          disabled={!clip}
          onClick={() => {
            if (clip)
              void playSessionClip(
                card.sessionId,
                clip.startMs,
                clip.endMs,
                0.7,
              );
          }}
        >
          <Trans>Slower</Trans>
        </Button>
        {!revealed ? (
          <Button className="ml-auto" onClick={onReveal}>
            <Trans>Show answer</Trans>
            <span className="text-primary-foreground/70 font-mono text-[11px]">
              Space
            </span>
          </Button>
        ) : null}
      </div>

      {revealed && clip ? (
        <ToneCheck sessionId={card.sessionId} clip={clip} />
      ) : null}
    </div>
  );
}

function ToneCheck({
  sessionId,
  clip,
}: {
  sessionId: string;
  clip: { startMs: number; endMs: number };
}) {
  const { t } = useLingui();
  const [teacher, setTeacher] = useState<Array<number | null> | null>(null);
  const [student, setStudent] = useState<Array<number | null> | null>(null);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const micRef = useRef<MicRecording | null>(null);

  useEffect(
    () => () => {
      micRef.current?.stop();
    },
    [],
  );

  const listen = async () => {
    setProblem(null);
    const url = await sessionAudioUrl(sessionId);
    if (!url) return;
    try {
      const frames = await samplePlayedClip(url, clip.startMs, clip.endMs);
      const contour = trimSilence(toRelativeContour(frames));
      setTeacher(contour.length > 1 ? contour : null);
      if (contour.length <= 1)
        setProblem(t`Couldn't hear a clear voice in the teacher's clip.`);
    } catch {
      setProblem(t`Couldn't read the teacher's clip.`);
    }
  };

  const toggleRecording = async () => {
    setProblem(null);
    if (micRef.current) {
      const frames = micRef.current.stop();
      micRef.current = null;
      setRecording(false);
      const contour = trimSilence(toRelativeContour(frames));
      setStudent(contour.length > 1 ? contour : null);
      if (contour.length <= 1)
        setProblem(t`Didn't catch your voice. Try again a little louder.`);
      return;
    }
    try {
      micRef.current = await startMicPitch();
      setRecording(true);
    } catch {
      setProblem(
        t`Mirna can't use the microphone here. You can still listen and grade yourself.`,
      );
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          <Trans>Check your tones</Trans>
        </span>
        <Button size="sm" variant="outline" onClick={() => void listen()}>
          <Trans>Teacher's pitch</Trans>
        </Button>
        <Button
          size="sm"
          className={cn([
            recording && "bg-mirna-terra hover:bg-mirna-terra/90 text-white",
          ])}
          onClick={() => void toggleRecording()}
        >
          {recording ? (
            <>
              <Square className="size-3" weight="bold" />
              <Trans>Stop</Trans>
            </>
          ) : (
            <>
              <Microphone className="size-3.5" />
              <Trans>Say it</Trans>
            </>
          )}
        </Button>
      </div>
      {teacher ? <PitchChart teacher={teacher} student={student} /> : null}
      {problem ? (
        <p className="text-muted-foreground text-xs">{problem}</p>
      ) : null}
    </div>
  );
}
