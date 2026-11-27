import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";
import { Microphone, Pause, Play, Square } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { cn } from "@anlg/utils";

import {
  playSessionClip,
  sessionAudioUrl,
  stopClip,
  usePlayingClip,
} from "../clip-player";
import {
  type ClipRange,
  findTermOccurrences,
  pickTermClip,
  recordingChannels,
} from "../clips";
import { LessonLanguageProvider } from "../language-context";
import { looksLikeLanguage, usesPinyin } from "../languages";
import {
  samplePlayedClip,
  smoothPitch,
  startMicPitch,
  toRelativeContour,
  trimSilence,
  type MicRecording,
} from "../pitch";
import {
  describeNext,
  dueCards,
  missedTones,
  type PracticeCard,
  type PracticeGrade,
  recordPracticeGrade,
  recordToneChecks,
} from "../practice";
import { practiceCardsFor, usePracticeLessons } from "../practice-data";
import type { LessonRoleOf } from "../roles";
import { formatClock } from "../time";
import {
  checkTones,
  type SyllableResult,
  toneFeedback,
  toneSyllables,
} from "../tones";
import { useLessonTranscript } from "../use-lesson-segments";
import { Formula, MathText } from "./math";
import { PitchChart } from "./pitch-chart";
import { LessonTerm } from "./term";

import { hasHan, usePinyinModule } from "~/stt/pinyin";

const GRADES: PracticeGrade[] = ["again", "hard", "good", "easy"];
const WORD_MODES = ["listen", "read", "shadow"] as const;
/** Topic and maths cards are practised one kind at a time. */
const SUBJECT_MODES = ["term", "question", "formula", "problem"] as const;
const MODES = [...WORD_MODES, ...SUBJECT_MODES] as const;
type Mode = (typeof MODES)[number];
type SubjectMode = (typeof SUBJECT_MODES)[number];

function isSubjectMode(mode: Mode): mode is SubjectMode {
  return (SUBJECT_MODES as readonly string[]).includes(mode);
}

/** Whether a card belongs in a mode: words in the word modes, the rest by kind. */
function inMode(card: Pick<PracticeCard, "kind">, mode: Mode) {
  return isSubjectMode(mode) ? card.kind === mode : card.kind === "word";
}
const MODE_KEY = "mirna:practice-mode";
const MAX_SENTENCE_SYLLABLES = 16;

type Range = ClipRange;
/** A sentence picked from the rail to shadow, by where it was said. */
type ShadowPick = { sessionId: string; text: string; atMs: number };
type Sentence = { sessionId: string; text: string; clip: Range | null };

function cardKey(card: Pick<PracticeCard, "sessionId" | "id">) {
  return `${card.sessionId}\u0000${card.id}`;
}

function storedMode(): Mode {
  try {
    const value = globalThis.localStorage?.getItem(MODE_KEY);
    return MODES.find((mode) => mode === value) ?? "listen";
  } catch {
    return "listen";
  }
}

/**
 * The sentence a clip falls in: the line split at sentence ends, the piece that
 * holds the term, timed from the line's words.
 */
export function sentenceAround(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf,
  clip: Range,
  term: string,
): { text: string; clip: Range } | null {
  const segment = segments.find(
    (item) =>
      item.start_ms <= clip.startMs + 300 && clip.startMs <= item.end_ms,
  );
  if (!segment) return null;
  const pieces = segment.text
    .split(/(?<=[。！？!?；;])|(?<=\.)\s+/u)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const piece =
    pieces.find((item) => item.includes(term)) ?? segment.text.trim();
  const channelOf = recordingChannels(segments);
  const found = findTermOccurrences([segment], piece, roleOf, channelOf)[0];
  const range = found
    ? { startMs: found.startMs, endMs: found.endMs }
    : { startMs: segment.start_ms, endMs: segment.end_ms };
  return {
    text: piece,
    clip: {
      startMs: Math.max(0, range.startMs - 200),
      endMs: Math.min(range.endMs + 400, range.startMs + 15_000),
      channel: channelOf(segment),
    },
  };
}

/** Where a picked sentence was said, nearest the time the study sheet gives. */
function locatePick(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf,
  pick: ShadowPick,
): Range {
  const found = findTermOccurrences(segments, pick.text, roleOf);
  if (found.length === 0) {
    return {
      startMs: Math.max(0, pick.atMs - 300),
      endMs: pick.atMs + 6_000,
    };
  }
  const nearest = found.reduce((best, item) =>
    Math.abs(item.startMs - pick.atMs) < Math.abs(best.startMs - pick.atMs)
      ? item
      : best,
  );
  return {
    startMs: Math.max(0, nearest.startMs - 200),
    endMs: nearest.endMs + 400,
    channel: nearest.channel,
  };
}

export function LessonPracticeDialog({
  sessionIds,
  focusSessionId,
  terms,
  everyCard = false,
  title,
  onClose,
}: {
  sessionIds: string[];
  /** Practise from this lesson's sheet: its words plus earlier words due again. */
  focusSessionId?: string;
  /** Only these words, by term. */
  terms?: readonly string[];
  /** Go through the chosen words even when they aren't due yet. */
  everyCard?: boolean;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const lessons = usePracticeLessons(sessionIds);
  const tools = usePinyinModule(true);
  const termsKey = terms?.join("\u0000") ?? null;
  const cards = useMemo(() => {
    const all = practiceCardsFor(lessons, focusSessionId);
    if (termsKey === null) return all;
    const wanted = new Set(termsKey.split("\u0000"));
    return all.filter((card) => wanted.has(card.id));
  }, [focusSessionId, lessons, termsKey]);
  const byKey = useMemo(
    () => new Map(cards.map((card) => [cardKey(card), card])),
    [cards],
  );
  const [queue, setQueue] = useState<string[] | null>(null);
  const [total, setTotal] = useState(0);
  const [startedWith, setStartedWith] = useState({ fresh: 0, review: 0 });
  const [revealed, setRevealed] = useState(false);
  const [chosenMode, setModeState] = useState<Mode>(storedMode);
  const [shadowPick, setShadowPick] = useState<ShadowPick | null>(null);
  const modes = useMemo(() => {
    const kinds = new Set(cards.map((card) => card.kind));
    // Maths classes start with their formulas, as their sheets do.
    const order: readonly SubjectMode[] =
      kinds.has("formula") || kinds.has("problem")
        ? ["formula", "problem", "term", "question"]
        : SUBJECT_MODES;
    return [
      ...(kinds.has("word") ? WORD_MODES : []),
      ...order.filter((kind) => kinds.has(kind)),
    ] as Mode[];
  }, [cards]);
  const mode: Mode = modes.includes(chosenMode)
    ? chosenMode
    : (modes[0] ?? "listen");

  const setMode = (next: Mode) => {
    // Words share one queue across their modes; each other kind has its own.
    if (isSubjectMode(next) || isSubjectMode(mode)) setQueue(null);
    setModeState(next);
    setRevealed(false);
    if (next !== "shadow") setShadowPick(null);
    try {
      globalThis.localStorage?.setItem(MODE_KEY, next);
    } catch {
      // The choice still holds while the dialog is open.
    }
  };

  const startQueue = (chosen: PracticeCard[]) => {
    setQueue(chosen.map(cardKey));
    setTotal(chosen.length);
    setStartedWith({
      fresh: chosen.filter((card) => !card.state).length,
      review: chosen.filter((card) => card.state).length,
    });
    setRevealed(false);
  };

  useEffect(() => {
    if (queue !== null || lessons.length === 0) return;
    const ofMode = cards.filter((card) => inMode(card, mode));
    const chosen = everyCard ? ofMode : dueCards(ofMode, new Date());
    setQueue(chosen.map(cardKey));
    setTotal(chosen.length);
    setStartedWith({
      fresh: chosen.filter((card) => !card.state).length,
      review: chosen.filter((card) => card.state).length,
    });
  }, [cards, everyCard, lessons.length, mode, queue]);

  useEffect(() => () => stopClip(), []);

  const current = queue && queue.length > 0 ? byKey.get(queue[0]!) : undefined;
  const lessonOf = useMemo(
    () => new Map(lessons.map((lesson) => [lesson.sessionId, lesson])),
    [lessons],
  );
  const showAnswer = mode === "listen" || mode === "shadow" || revealed;
  const languageOf = (sessionId: string) =>
    lessonOf.get(sessionId)?.settings?.learning ?? null;
  const practisesChinese =
    modes.includes("listen") &&
    lessons.some(
      (lesson) =>
        usesPinyin(lesson.settings?.learning) &&
        (lesson.sheet?.sheet.vocabulary.length ?? 0) > 0,
    );

  const grade = (value: PracticeGrade) => {
    if (!current || !queue) return;
    const comesBackSoon =
      value === "again" || (value === "hard" && !current.state);
    void recordPracticeGrade(current, value);
    stopClip();
    setRevealed(false);
    setShadowPick(null);
    setQueue(comesBackSoon ? [...queue.slice(1), queue[0]!] : queue.slice(1));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.key === " " && !showAnswer && current) {
      event.preventDefault();
      setRevealed(true);
    } else if (showAnswer && current && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      grade(GRADES[Number(event.key) - 1]!);
    }
  };

  const toneChecks = useMemo(
    () => lessons.flatMap((lesson) => lesson.practice?.toneChecks ?? []),
    [lessons],
  );
  const missed = useMemo(
    () => missedTones(toneChecks).slice(0, 2),
    [toneChecks],
  );
  const toneName: Record<number, string> = {
    1: t`First tone`,
    2: t`Second tone`,
    3: t`Third tone`,
    4: t`Fourth tone`,
  };
  const drillName: Record<number, string> = {
    1: t`Drill first tones`,
    2: t`Drill second tones`,
    3: t`Drill third tones`,
    4: t`Drill fourth tones`,
  };
  const drill = (tone: number) => {
    if (!tools) return;
    startQueue(
      cards
        .filter((card) =>
          toneSyllables(card.item.term, tools, card.item.reading).some(
            (syllable) => syllable.tone === tone,
          ),
        )
        .slice(0, 20),
    );
  };

  const sentences = useMemo(
    () =>
      [...lessons]
        .sort((a, b) => b.started.localeCompare(a.started))
        .flatMap((lesson) =>
          (lesson.sheet?.sheet.patterns ?? []).flatMap((pattern) =>
            pattern.examples
              .filter(
                (example) =>
                  example.atMs !== null &&
                  (lesson.settings
                    ? looksLikeLanguage(example.text, lesson.settings.learning)
                    : hasHan(example.text)),
              )
              .map((example) => ({
                sessionId: lesson.sessionId,
                lessonTitle: lesson.title,
                text: example.text,
                atMs: example.atMs!,
              })),
          ),
        )
        .slice(0, 4),
    [lessons],
  );

  const done = total - (queue?.length ?? 0);
  const modeLabels: Record<Mode, string> = {
    listen: t`Listen and say`,
    read: t`Read`,
    shadow: t`Shadow a sentence`,
    term: t`Key terms`,
    question: t`Check yourself`,
    formula: t`Formulas`,
    problem: t`Problems`,
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92vh] w-[min(1100px,95vw)] max-w-none overflow-y-auto p-0 sm:max-w-none"
        onKeyDown={onKeyDown}
      >
        <div className="flex flex-wrap items-start gap-7 p-7">
          <section
            aria-label={t`Practice card`}
            className="flex min-w-0 flex-[999_1_520px] flex-col gap-4"
          >
            <div className="flex flex-wrap items-center gap-3 pr-6">
              <DialogTitle className="font-brand text-3xl font-medium">
                <Trans>Practise</Trans>
              </DialogTitle>
              {total > 0 ? (
                <span className="text-muted-foreground font-mono text-sm">
                  <Trans>
                    {Math.min(done + 1, total)} of {total}
                  </Trans>
                </span>
              ) : null}
              <DialogDescription className="sr-only">{title}</DialogDescription>
              <div
                role="radiogroup"
                aria-label={t`Practice mode`}
                className="bg-muted ml-auto inline-flex rounded-xl p-[3px]"
              >
                {modes.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={cn([
                      "h-8 rounded-lg px-3 text-sm font-semibold",
                      mode === value
                        ? "bg-background text-mirna-serra dark:text-mirna-moss shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    ])}
                  >
                    {modeLabels[value]}
                  </button>
                ))}
              </div>
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
            ) : isSubjectMode(mode) ? (
              <RecallCardView
                key={cardKey(current)}
                card={current}
                lessonTitle={lessonOf.get(current.sessionId)?.title ?? ""}
                showAnswer={showAnswer}
                onReveal={() => setRevealed(true)}
              />
            ) : (
              <LessonLanguageProvider language={languageOf(current.sessionId)}>
                <PracticeCardView
                  key={`${cardKey(current)}:${mode}:${shadowPick?.text ?? ""}`}
                  card={current}
                  lessonTitle={lessonOf.get(current.sessionId)?.title ?? ""}
                  language={languageOf(current.sessionId)}
                  mode={mode}
                  showAnswer={showAnswer}
                  onReveal={() => setRevealed(true)}
                  shadowPick={shadowPick}
                  tools={tools}
                />
              </LessonLanguageProvider>
            )}

            {current && !showAnswer ? (
              <p className="text-muted-foreground text-center text-xs">
                {isSubjectMode(mode) ? (
                  <Trans>
                    Answer it in your head, out loud or on paper, then show the
                    answer. You judge how close you were.
                  </Trans>
                ) : (
                  <Trans>
                    Say it out loud, then show the answer. Rating yourself takes
                    you to the next word.
                  </Trans>
                )}
              </p>
            ) : null}

            {current && showAnswer ? (
              <div className="bg-background sticky bottom-0 flex flex-col gap-2 pt-2">
                <p className="text-muted-foreground text-xs">
                  {isSubjectMode(mode) ? (
                    <Trans>
                      How well did you know it? Pick one to go to the next card.
                    </Trans>
                  ) : (
                    <Trans>
                      How well did you know it? Pick one to go to the next word.
                    </Trans>
                  )}
                </p>
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
                        {index + 1} ·{" "}
                        {describeNext(current.state, value, new Date())}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside
            aria-label={t`Practice overview`}
            className="flex flex-[1_1_240px] flex-col gap-3.5"
          >
            <RailPanel title={t`Due today`}>
              <span className="font-brand text-mirna-serra dark:text-mirna-moss text-3xl leading-none font-medium">
                {total}
              </span>
              <div className="flex justify-between text-sm">
                {isSubjectMode(mode) ? (
                  <Trans>New cards</Trans>
                ) : (
                  <Trans>New words</Trans>
                )}
                <span className="text-muted-foreground">
                  {startedWith.fresh}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <Trans>To review</Trans>
                <span className="text-muted-foreground">
                  {startedWith.review}
                </span>
              </div>
            </RailPanel>

            {practisesChinese ? (
              <RailPanel title={t`Tones you miss most`}>
                {missed.length > 0 ? (
                  <>
                    {missed.map((item) => (
                      <div
                        key={item.tone}
                        className="flex justify-between gap-2 text-sm"
                      >
                        <b>{toneName[item.tone]}</b>
                        <span className="text-muted-foreground">
                          <Trans>
                            {item.missed} of your last {item.of}
                          </Trans>
                        </span>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!tools}
                      onClick={() => drill(missed[0]!.tone)}
                    >
                      {drillName[missed[0]!.tone]}
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    <Trans>
                      Say words out loud and Mirna keeps track of the tones you
                      miss.
                    </Trans>
                  </p>
                )}
              </RailPanel>
            ) : null}

            {sentences.length > 0 && !isSubjectMode(mode) ? (
              <RailPanel title={t`Shadow a sentence`}>
                {sentences.map((sentence) => (
                  <button
                    key={`${sentence.sessionId}:${sentence.atMs}`}
                    type="button"
                    onClick={() => {
                      setMode("shadow");
                      setShadowPick({
                        sessionId: sentence.sessionId,
                        text: sentence.text,
                        atMs: sentence.atMs,
                      });
                    }}
                    className="bg-background hover:bg-accent flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left"
                  >
                    <LessonTerm term={sentence.text} className="text-base" />
                    <small className="text-muted-foreground text-xs">
                      {sentence.lessonTitle} · {formatClock(sentence.atMs)}
                    </small>
                  </button>
                ))}
              </RailPanel>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RailPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
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

function ClipButton({
  id,
  sessionId,
  clip,
  rate = 1,
  dark,
  children,
}: {
  id: string;
  sessionId: string;
  clip: Range | null;
  rate?: number;
  dark?: boolean;
  children: React.ReactNode;
}) {
  const playing = usePlayingClip((state) => state.id) === id;
  return (
    <Button
      variant={dark ? "default" : "outline"}
      disabled={!clip}
      aria-pressed={playing}
      onClick={() => {
        if (playing) stopClip();
        else if (clip) void playSessionClip(sessionId, clip, rate, id);
      }}
    >
      {playing ? (
        <Pause className="size-3.5" weight="bold" />
      ) : (
        <Play className="size-3.5" weight="bold" />
      )}
      {children}
    </Button>
  );
}

function PracticeCardView({
  card,
  lessonTitle,
  language,
  mode,
  showAnswer,
  onReveal,
  shadowPick,
  tools,
}: {
  card: PracticeCard;
  lessonTitle: string;
  language: string | null;
  mode: Mode;
  showAnswer: boolean;
  onReveal: () => void;
  shadowPick: ShadowPick | null;
  tools: ReturnType<typeof usePinyinModule>;
}) {
  const { t } = useLingui();
  const own = useLessonTranscript(card.sessionId);
  const picked = useLessonTranscript(shadowPick?.sessionId ?? null);
  const clip = useMemo(
    () =>
      pickTermClip(
        findTermOccurrences(own.segments, card.item.term, own.roleOf),
        card.item.heardAtMs,
      ),
    [card.item.heardAtMs, card.item.term, own.roleOf, own.segments],
  );
  const sentence = useMemo<Sentence | null>(() => {
    if (shadowPick) {
      return {
        sessionId: shadowPick.sessionId,
        text: shadowPick.text,
        clip: picked.ready
          ? locatePick(picked.segments, picked.roleOf, shadowPick)
          : null,
      };
    }
    if (!clip) return null;
    const around = sentenceAround(
      own.segments,
      own.roleOf,
      clip,
      card.item.term,
    );
    return around ? { sessionId: card.sessionId, ...around } : null;
  }, [
    card.item.term,
    card.sessionId,
    clip,
    own.roleOf,
    own.segments,
    picked.ready,
    picked.roleOf,
    picked.segments,
    shadowPick,
  ]);

  // Listen and say starts with the teacher's voice, as a class would.
  const played = useRef(false);
  useEffect(() => {
    if (mode !== "listen" || played.current || !own.ready || !clip) return;
    played.current = true;
    void playSessionClip(card.sessionId, clip, 1, "teacher");
  }, [card.sessionId, clip, mode, own.ready]);

  const shadowing = mode === "shadow";
  const spoken = shadowing ? (sentence?.text ?? "") : card.item.term;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border p-7">
      {shadowing ? (
        <div className="flex flex-col gap-2">
          {sentence ? (
            <LessonTerm
              term={sentence.text}
              pinyin
              toneColours
              className="text-4xl leading-snug font-medium"
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {own.ready ? (
                <Trans>No sentence with this word in the transcript.</Trans>
              ) : (
                <Trans>Finding the sentence…</Trans>
              )}
            </p>
          )}
          {shadowPick ? null : (
            <span className="text-muted-foreground text-sm">
              {card.item.term} · {card.item.meaning}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-6">
          <LessonTerm
            term={card.item.term}
            reading={card.item.reading}
            toneColours={showAnswer}
            pinyin={false}
            className="text-7xl leading-none font-medium tracking-wide"
          />
          {showAnswer ? (
            <div className="flex flex-col gap-1 pb-1">
              {card.item.reading ? (
                <span className="text-2xl font-medium">
                  {card.item.reading}
                </span>
              ) : null}
              <span className="text-muted-foreground">{card.item.meaning}</span>
              {lessonTitle ? (
                <span className="text-muted-foreground text-xs">
                  {clip ? (
                    <Trans>
                      {lessonTitle} · teacher at{" "}
                      <span className="font-mono">
                        {formatClock(clip.startMs)}
                      </span>
                    </Trans>
                  ) : (
                    lessonTitle
                  )}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {showAnswer ? (
        <div className="flex flex-wrap gap-2">
          {shadowing ? (
            <>
              <ClipButton
                id="sentence"
                sessionId={sentence?.sessionId ?? card.sessionId}
                clip={sentence?.clip ?? null}
                dark
              >
                <Trans>The sentence</Trans>
              </ClipButton>
              <ClipButton
                id="sentence-slow"
                sessionId={sentence?.sessionId ?? card.sessionId}
                clip={sentence?.clip ?? null}
                rate={0.75}
              >
                <Trans>Slower</Trans>
              </ClipButton>
            </>
          ) : (
            <>
              <ClipButton
                id="teacher"
                sessionId={card.sessionId}
                clip={clip}
                dark
              >
                <Trans>Teacher</Trans>
              </ClipButton>
              <ClipButton
                id="slower"
                sessionId={card.sessionId}
                clip={clip}
                rate={0.7}
              >
                <Trans>Slower</Trans>
              </ClipButton>
              <ClipButton
                id="in-sentence"
                sessionId={card.sessionId}
                clip={sentence?.clip ?? null}
              >
                <Trans>In the sentence</Trans>
              </ClipButton>
            </>
          )}
        </div>
      ) : (
        <div className="flex justify-end">
          <Button onClick={onReveal}>
            <Trans>Show answer</Trans>
            <span className="text-primary-foreground/70 font-mono text-[11px]">
              Space
            </span>
          </Button>
        </div>
      )}

      {showAnswer && spoken && usesPinyin(language) && hasHan(spoken) ? (
        <YourTurn
          key={spoken}
          sessionId={card.sessionId}
          spoken={spoken}
          reading={shadowing ? undefined : card.item.reading}
          teacherClip={shadowing ? (sentence?.clip ?? null) : clip}
          teacherSessionId={
            shadowing ? (sentence?.sessionId ?? card.sessionId) : card.sessionId
          }
          tools={tools}
          label={t`Your turn`}
        />
      ) : null}
    </div>
  );
}

const SILENCE_FRAMES_TO_STOP = 22; // about 0.7 s of quiet after the voice
const MAX_RECORDING_FRAMES = 330; // about 10 s

function YourTurn({
  sessionId,
  spoken,
  reading,
  teacherClip,
  teacherSessionId,
  tools,
  label,
}: {
  sessionId: string;
  spoken: string;
  reading?: string;
  teacherClip: Range | null;
  teacherSessionId: string;
  tools: ReturnType<typeof usePinyinModule>;
  label: string;
}) {
  const { t } = useLingui();
  const syllables = useMemo(
    () =>
      tools
        ? toneSyllables(spoken, tools, reading).slice(0, MAX_SENTENCE_SYLLABLES)
        : [],
    [reading, spoken, tools],
  );
  const [teacher, setTeacher] = useState<Array<number | null> | null>(null);
  const [student, setStudent] = useState<Array<number | null> | null>(null);
  const [results, setResults] = useState<SyllableResult[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const micRef = useRef<MicRecording | null>(null);
  const watchRef = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const syllablesRef = useRef(syllables);
  syllablesRef.current = syllables;

  const contourOf = (frames: Array<number | null>) =>
    trimSilence(toRelativeContour(smoothPitch(frames)));

  const stopWatching = () => {
    if (watchRef.current !== null) window.clearInterval(watchRef.current);
    watchRef.current = null;
  };

  const finish = () => {
    stopWatching();
    holdingRef.current = false;
    const mic = micRef.current;
    if (!mic) return;
    micRef.current = null;
    setRecording(false);
    const contour = contourOf(mic.stop());
    if (contour.filter((value) => value !== null).length < 4) {
      setStudent(null);
      setResults(null);
      setProblem(t`Didn't catch your voice. Try again a little louder.`);
      return;
    }
    const checked = checkTones(syllablesRef.current, contour);
    setStudent(contour);
    setResults(checked);
    void recordToneChecks(
      sessionId,
      checked.map((result) => ({ tone: result.syllable.tone, ok: result.ok })),
    );
  };

  const start = async ({ hold }: { hold: boolean }) => {
    if (micRef.current) return;
    setProblem(null);
    setResults(null);
    stopClip();
    try {
      const mic = await startMicPitch();
      micRef.current = mic;
      holdingRef.current = hold;
      setRecording(true);
      watchRef.current = window.setInterval(() => {
        const frames = mic.frames();
        if (frames.length >= MAX_RECORDING_FRAMES) {
          finish();
          return;
        }
        // Holding Space keeps listening; a click stops after the voice ends.
        if (holdingRef.current) return;
        let lastVoiced = -1;
        for (let index = frames.length - 1; index >= 0; index--) {
          if (frames[index] !== null) {
            lastVoiced = index;
            break;
          }
        }
        if (
          lastVoiced >= 0 &&
          frames.length - 1 - lastVoiced >= SILENCE_FRAMES_TO_STOP
        ) {
          finish();
        }
      }, 100);
    } catch {
      setProblem(
        t`Mirna can't use the microphone here. You can still listen and grade yourself.`,
      );
    }
  };

  // Hold Space to talk; letting go checks it. The handlers only read refs and
  // stable setters, so they are bound once.
  const startRef = useRef(start);
  startRef.current = start;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat) return;
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      void startRef.current({ hold: true });
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== " " || !holdingRef.current) return;
      event.preventDefault();
      finishRef.current();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (watchRef.current !== null) window.clearInterval(watchRef.current);
      micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  const addTeacher = async () => {
    setProblem(null);
    if (!teacherClip) return;
    const url = await sessionAudioUrl(teacherSessionId);
    if (!url) return;
    try {
      const contour = contourOf(await samplePlayedClip(url, teacherClip));
      setTeacher(contour.length > 3 ? contour : null);
      if (contour.length <= 3)
        setProblem(t`Couldn't hear a clear voice in the teacher's clip.`);
    } catch {
      setProblem(t`Couldn't read the teacher's clip.`);
    }
  };

  if (syllables.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {label}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {teacherClip && !teacher ? (
            <Button size="sm" variant="ghost" onClick={() => void addTeacher()}>
              <Trans>Add the teacher's pitch</Trans>
            </Button>
          ) : null}
          <button
            type="button"
            onClick={() => (recording ? finish() : void start({ hold: false }))}
            className={cn([
              "inline-flex h-11 items-center gap-2.5 rounded-full px-4 text-sm font-semibold text-white",
              recording ? "bg-mirna-serra" : "bg-mirna-terra hover:opacity-90",
            ])}
          >
            {recording ? (
              <>
                <Square className="size-3.5" weight="bold" />
                <Trans>Listening… let go or click</Trans>
              </>
            ) : (
              <>
                <Microphone className="size-4" />
                <Trans>Hold Space and say it</Trans>
              </>
            )}
          </button>
        </div>
      </div>
      <PitchChart syllables={syllables} teacher={teacher} student={student} />
      {results ? (
        <ul aria-label={t`Your tones`} className="grid gap-2.5 sm:grid-cols-2">
          {results.map((result, index) => (
            <li
              key={index}
              className={cn([
                "rounded-lg px-3 py-2.5 text-sm leading-relaxed",
                result.ok
                  ? "dark:bg-mirna-serra/30 dark:text-mirna-moss bg-[#E3EADF] text-[#22382C]"
                  : "bg-[#F6E4DB] text-[#5E2914] dark:bg-orange-950/40 dark:text-orange-100",
              ])}
            >
              <b className="block text-sm">{result.syllable.pinyin}</b>
              {toneFeedback(result, tools)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>
            Hold Space while you say it, or click the button and Mirna stops
            when you finish. Each syllable's tone gets checked.
          </Trans>
        </p>
      )}
      {problem ? (
        <p className="text-muted-foreground text-xs">{problem}</p>
      ) : null}
    </div>
  );
}

/** A clip of the teacher explaining it: from just before the moment, for 15 seconds. */
function explanationClip(atMs: number | null): Range | null {
  return atMs === null
    ? null
    : { startMs: Math.max(0, atMs - 500), endMs: atMs + 15_000 };
}

/**
 * A topic or maths card: explain the key term, answer the question, write out
 * the formula or solve the problem, then compare with what the class said.
 * Nothing is marked; the student grades themselves.
 */
function RecallCardView({
  card,
  lessonTitle,
  showAnswer,
  onReveal,
}: {
  card: PracticeCard;
  lessonTitle: string;
  showAnswer: boolean;
  onReveal: () => void;
}) {
  const { t } = useLingui();
  const [answer, setAnswer] = useState("");
  const [stepsShown, setStepsShown] = useState(0);
  const clip = explanationClip(card.item.heardAtMs);
  const steps = card.steps ?? [];
  const writes = card.kind === "term" || card.kind === "question";

  return (
    <div className="flex flex-col gap-5 rounded-2xl border p-7">
      {lessonTitle ? (
        <span className="text-muted-foreground text-xs">{lessonTitle}</span>
      ) : null}
      {card.kind === "term" ? (
        <div className="font-brand text-mirna-serra dark:text-mirna-moss text-5xl leading-none font-medium">
          {card.item.term}
        </div>
      ) : card.kind === "formula" ? (
        <div className="font-brand text-mirna-serra dark:text-mirna-moss text-4xl leading-tight font-medium">
          {card.item.term}
        </div>
      ) : (
        <MathText
          text={card.item.term}
          className="text-xl leading-relaxed font-medium"
        />
      )}

      {writes ? (
        <label className="text-muted-foreground flex flex-col gap-1.5 text-xs font-semibold">
          {card.kind === "term" ? (
            <Trans>Say or type what it means, then check.</Trans>
          ) : (
            <Trans>Say or type your answer, then check.</Trans>
          )}
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            aria-label={t`Your answer`}
            className="bg-background text-foreground min-h-20 rounded-xl border px-3 py-2 text-base font-normal"
          />
        </label>
      ) : card.kind === "formula" ? (
        <p className="bg-muted/60 rounded-lg px-3 py-2 text-sm">
          <Trans>Write it out on paper, then check.</Trans>
        </p>
      ) : null}

      {card.kind === "problem" && !showAnswer && stepsShown > 0 ? (
        <ol className="flex flex-col gap-2">
          {steps.slice(0, stepsShown).map((step, index) => (
            <li key={index} className="flex items-start gap-2.5 text-sm">
              <span className="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss rounded-pill flex size-6 shrink-0 items-center justify-center text-xs font-bold">
                {index + 1}
              </span>
              <MathText text={step} className="pt-0.5" />
            </li>
          ))}
        </ol>
      ) : null}

      {showAnswer ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          {card.kind === "formula" ? (
            <>
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                <Trans>The formula</Trans>
              </h3>
              <div className="bg-mirna-mist/50 dark:bg-muted flex min-h-24 items-center justify-center overflow-x-auto rounded-xl px-3 py-4 text-xl">
                <Formula latex={card.latex ?? ""} display />
              </div>
              {card.item.meaning ? (
                <p className="bg-mirna-mist/70 dark:bg-muted rounded-lg px-3 py-2 text-sm leading-relaxed">
                  {card.item.meaning}
                </p>
              ) : null}
            </>
          ) : card.kind === "problem" ? (
            <>
              {steps.length > 0 ? (
                <ol className="flex flex-col gap-2">
                  {steps.map((step, index) => (
                    <li
                      key={index}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <span className="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss rounded-pill flex size-6 shrink-0 items-center justify-center text-xs font-bold">
                        {index + 1}
                      </span>
                      <MathText text={step} className="pt-0.5" />
                    </li>
                  ))}
                </ol>
              ) : null}
              {card.item.meaning ? (
                <div className="bg-mirna-moss/50 dark:bg-mirna-serra/30 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold">
                  <Trans>Answer</Trans>
                  <MathText text={card.item.meaning} className="font-medium" />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                {card.kind === "term" ? (
                  <Trans>In the teacher's words</Trans>
                ) : (
                  <Trans>The class's answer</Trans>
                )}
              </h3>
              <MathText
                text={card.item.meaning}
                className="text-base leading-relaxed"
              />
            </>
          )}
          {clip ? (
            <div className="flex flex-wrap gap-2">
              <ClipButton
                id="explained"
                sessionId={card.sessionId}
                clip={clip}
                dark
              >
                <Trans>Hear it explained</Trans>
                <span className="font-mono text-xs opacity-80">
                  {formatClock(card.item.heardAtMs ?? clip.startMs)}
                </span>
              </ClipButton>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {card.kind === "problem" && stepsShown < steps.length ? (
            <Button
              variant="outline"
              onClick={() => setStepsShown((count) => count + 1)}
            >
              <Trans>Show next step</Trans>
            </Button>
          ) : null}
          <Button onClick={onReveal}>
            <Trans>Show answer</Trans>
            <span className="text-primary-foreground/70 font-mono text-[11px]">
              Space
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
