import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";

import { MagnifyingGlass, Pause, Play } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { playSessionClip, stopClip, usePlayingClip } from "../clip-player";
import { findTermOccurrences, pickTermClip } from "../clips";
import {
  type CourseLesson,
  type CourseWord,
  filterCourseWords,
  sortCourseWords,
  type WordFilter,
  type WordSort,
} from "../course-data";
import { useLessonLanguage } from "../language-context";
import { usesPinyin } from "../languages";
import { markWordKnown, type WordState } from "../practice";
import { formatClock } from "../time";
import { LessonPracticeDialog } from "./practice-dialog";
import { LessonTerm } from "./term";
import { ToneLegend } from "./tone-legend";

const COLLAPSED_ROWS = 8;
const EXCERPT_CHARS = 14;

/** The words around the nth time a term appears in a line, for the word card. */
export function excerpt(text: string, term: string, nth: number): string {
  const line = text.trim();
  let at = -1;
  for (let count = 0; count <= nth; count++) {
    at = line.indexOf(term, at + 1);
    if (at === -1) break;
  }
  if (at === -1) at = line.indexOf(term);
  if (at === -1) return line.slice(0, EXCERPT_CHARS * 2);
  const start = Math.max(0, at - EXCERPT_CHARS);
  const end = Math.min(line.length, at + term.length + EXCERPT_CHARS);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

function useStateLabels(): Record<WordState, string> {
  const { t } = useLingui();
  return { new: t`New`, learning: t`Learning`, known: t`Known` };
}

function StatePill({ state }: { state: WordState }) {
  const labels = useStateLabels();
  return (
    <span
      className={cn([
        "rounded-pill justify-self-start px-2.5 py-0.5 text-[11px] font-bold",
        state === "new" &&
          "bg-[#FCEFD0] text-[#6B4D07] dark:bg-[#6B4D07]/40 dark:text-[#FCEFD0]",
        state === "learning" &&
          "bg-[#DDE7F4] text-[#24497A] dark:bg-[#24497A]/40 dark:text-[#DDE7F4]",
        state === "known" &&
          "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss",
      ])}
    >
      {labels[state]}
    </span>
  );
}

function LessonStrip({ word }: { word: CourseWord }) {
  return (
    <span
      aria-hidden="true"
      className="grid w-full max-w-[170px] gap-[2px]"
      style={{
        gridTemplateColumns: `repeat(${word.inLessons.length}, minmax(0, 1fr))`,
      }}
    >
      {word.inLessons.map((on, index) => (
        <span
          key={index}
          className={cn([
            "block h-3 rounded-[2px]",
            on ? "bg-mirna-serra dark:bg-mirna-moss" : "bg-muted",
          ])}
        />
      ))}
    </span>
  );
}

/**
 * Every word of the course with how often the teacher and you said it and in
 * which lessons, to search, filter and sort; a word opens its card.
 */
export function CourseWords({
  words,
  lessons,
  glossary = false,
}: {
  words: CourseWord[];
  lessons: CourseLesson[];
  /** A topic or maths course: key terms with their definitions. */
  glossary?: boolean;
}) {
  const { t } = useLingui();
  const language = useLessonLanguage();
  const [sort, setSort] = useState<WordSort>("said");
  const [filter, setFilter] = useState<WordFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const labels = useStateLabels();

  const shown = useMemo(
    () => sortCourseWords(filterCourseWords(words, { query, filter }), sort),
    [filter, query, sort, words],
  );
  const counts = useMemo(() => {
    const result = { all: words.length, new: 0, learning: 0, known: 0 };
    for (const word of words) result[word.state]++;
    return result;
  }, [words]);
  const maxSaid = Math.max(1, ...words.map((word) => word.said));
  const searching = query.trim() !== "" || filter !== "all";
  const rows = expanded || searching ? shown : shown.slice(0, COLLAPSED_ROWS);
  const selectedWord = words.find((word) => word.term === selected) ?? null;

  const sortLabels: Record<WordSort, string> = {
    said: t`Most said`,
    newest: t`Newest`,
    hardest: t`Hardest`,
    az: t`A–Z`,
  };

  if (words.length === 0) return null;

  return (
    <section aria-labelledby="course-words" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2
          id="course-words"
          className="font-brand flex items-baseline gap-2 text-lg font-medium"
        >
          {glossary ? <Trans>Glossary</Trans> : <Trans>All words</Trans>}
          <span className="text-muted-foreground font-sans text-sm font-normal">
            {words.length}
          </span>
        </h2>
        <div
          role="radiogroup"
          aria-label={t`Sort words`}
          className="bg-muted flex rounded-lg p-0.5 text-xs"
        >
          {(Object.keys(sortLabels) as WordSort[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={sort === value}
              onClick={() => setSort(value)}
              className={cn([
                "rounded-md px-2.5 py-1 font-medium",
                sort === value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              ])}
            >
              {sortLabels[value]}
            </button>
          ))}
        </div>
        {!glossary && usesPinyin(language) ? (
          <ToneLegend className="ml-auto" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="bg-background flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-2.5 text-sm sm:max-w-xs">
          <MagnifyingGlass className="text-muted-foreground size-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              glossary
                ? t`Search terms or definitions`
                : usesPinyin(language)
                  ? t`Search characters, pinyin or meaning`
                  : t`Search words or meanings`
            }
            aria-label={t`Search words`}
            className="min-w-0 flex-1 bg-transparent outline-hidden"
          />
        </label>
        <div role="radiogroup" aria-label={t`Show`} className="flex gap-1.5">
          {(["all", "new", "learning", "known"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => setFilter(value)}
              className={cn([
                "rounded-pill border px-2.5 py-1 text-xs font-medium",
                filter === value
                  ? "border-mirna-serra bg-mirna-serra dark:bg-mirna-moss dark:text-mirna-serra text-white"
                  : "hover:bg-accent",
              ])}
            >
              {value === "all" ? t`All` : labels[value]}{" "}
              <span className="opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {glossary ? <Trans>Term</Trans> : <Trans>Word</Trans>}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {glossary ? <Trans>Definition</Trans> : <Trans>Meaning</Trans>}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Times said</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Lessons 1–{lessons.length}</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Practice</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((word) => (
              <tr
                key={word.term}
                className="hover:bg-accent/60 cursor-pointer border-t"
                onClick={() => setSelected(word.term)}
              >
                <td
                  className={
                    glossary || !usesPinyin(language)
                      ? "text-mirna-serra dark:text-mirna-moss px-4 py-2 text-base font-semibold"
                      : "px-4 py-2 text-2xl"
                  }
                >
                  <button
                    type="button"
                    className="text-left"
                    aria-label={t`Open ${word.term}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(word.term);
                    }}
                  >
                    <LessonTerm term={word.term} reading={word.reading} />
                  </button>
                </td>
                <td className="px-3 py-2">{word.meaning}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden="true"
                      className="bg-mirna-serra dark:bg-mirna-moss h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(4, (word.said / maxSaid) * 64)}px`,
                      }}
                    />
                    <span className="font-mono">{word.said}×</span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <LessonStrip word={word} />
                  <span className="sr-only">
                    <Trans>In {word.lessonCount} lessons</Trans>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StatePill state={word.state} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-muted-foreground px-4 py-6 text-center"
                >
                  <Trans>No words match.</Trans>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {!searching && shown.length > COLLAPSED_ROWS ? (
          <div className="flex justify-center border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <Trans>Show fewer</Trans>
              ) : (
                <Trans>Show all {shown.length} words</Trans>
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {selectedWord ? (
        <WordCard
          word={selectedWord}
          lessons={lessons}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}

function WordCard({
  word,
  lessons,
  onClose,
}: {
  word: CourseWord;
  lessons: CourseLesson[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [practising, setPractising] = useState(false);
  const playing = usePlayingClip((state) => state.id);

  const places = useMemo(
    () =>
      lessons.flatMap((lesson) => {
        const transcript = lesson.transcript;
        if (!transcript) return [];
        const seenInSegment = new Map<string, number>();
        return findTermOccurrences(
          transcript.segments,
          word.term,
          transcript.roleOf,
        ).map((occurrence, index) => {
          const segment = transcript.segments.find(
            (item) =>
              item.start_ms <= occurrence.startMs &&
              occurrence.startMs <= item.end_ms,
          );
          const nth = segment ? (seenInSegment.get(segment.id) ?? 0) : 0;
          if (segment) seenInSegment.set(segment.id, nth + 1);
          const clip = pickTermClip([occurrence], occurrence.startMs)!;
          return {
            id: `${lesson.sessionId}:${index}`,
            lesson,
            occurrence,
            clip,
            text: segment ? excerpt(segment.text, word.term, nth) : "",
          };
        });
      }),
    [lessons, word.term],
  );

  const firstLesson = lessons[word.first];
  const lastLesson = lessons[word.last];
  const state = word.card.state;
  const dueDate = state ? new Date(state.due) : null;
  const lessonName = (lesson: CourseLesson | undefined) =>
    lesson
      ? lesson.sheet?.sheet.topic || lesson.title || t`Lesson ${lesson.number}`
      : "–";

  const markKnown = async () => {
    try {
      await markWordKnown(word.card);
      toast.success(t`${word.term} won't come back for two months.`);
    } catch {
      toast.error(t`Couldn't save that.`);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && (stopClip(), onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <div className="flex flex-wrap items-end gap-5">
          <DialogTitle className="text-5xl leading-none font-medium">
            <LessonTerm
              term={word.term}
              reading={word.reading}
              pinyin
              toneColours
            />
          </DialogTitle>
          <DialogDescription className="pb-1 text-base">
            {word.meaning}
          </DialogDescription>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t`said in class`, `${word.said}×`],
            [
              word.lessonCount === 1 ? t`lesson` : t`lessons`,
              String(word.lessonCount),
            ],
            [t`first heard`, firstLesson ? `L${firstLesson.number}` : "–"],
            [t`last heard`, lastLesson ? `L${lastLesson.number}` : "–"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border px-3 py-2">
              <dd className="font-brand text-mirna-serra dark:text-mirna-moss text-xl">
                {value}
              </dd>
              <dt className="text-muted-foreground text-xs">{label}</dt>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">
          {firstLesson ? (
            <Trans>
              First in {lessonName(firstLesson)}
              {lastLesson && lastLesson !== firstLesson
                ? `, last in ${lessonName(lastLesson)}`
                : ""}
              .
            </Trans>
          ) : null}
        </p>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            <Trans>Where it was said</Trans>
          </h3>
          {places.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <Trans>
                Not found in the transcripts; it's on a study sheet.
              </Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {places.slice(0, 20).map((place) => {
                const isPlaying = playing === place.id;
                return (
                  <li
                    key={place.id}
                    className="flex items-start gap-3 rounded-lg border px-3 py-2"
                  >
                    <button
                      type="button"
                      aria-label={isPlaying ? t`Pause` : t`Play this moment`}
                      aria-pressed={isPlaying}
                      onClick={() =>
                        isPlaying
                          ? stopClip()
                          : void playSessionClip(
                              place.lesson.sessionId,
                              place.clip.startMs,
                              place.clip.endMs,
                              1,
                              place.id,
                            )
                      }
                      className={cn([
                        "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
                        isPlaying
                          ? "bg-mirna-serra border-mirna-serra text-white"
                          : "text-mirna-serra hover:bg-accent dark:text-mirna-moss",
                      ])}
                    >
                      {isPlaying ? (
                        <Pause className="size-3" weight="bold" />
                      ) : (
                        <Play className="size-3" weight="bold" />
                      )}
                    </button>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm">
                        <LessonTerm term={place.text || word.term} />
                      </span>
                      <span className="text-muted-foreground text-xs">
                        L{place.lesson.number} ·{" "}
                        {formatClock(place.occurrence.startMs)} ·{" "}
                        {place.occurrence.byTeacher ? t`teacher` : t`you`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <StatePill state={word.state} />
          <span className="text-muted-foreground text-xs">
            {!state ? (
              <Trans>Not practised yet.</Trans>
            ) : dueDate && dueDate.getTime() <= Date.now() ? (
              <Trans>Due now.</Trans>
            ) : (
              <Trans>Comes back on {dueDate?.toLocaleDateString()}.</Trans>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            {word.state !== "known" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void markKnown()}
              >
                <Trans>Mark as known</Trans>
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setPractising(true)}>
              <Trans>Practise this word</Trans>
            </Button>
          </div>
        </div>

        {practising ? (
          <LessonPracticeDialog
            sessionIds={[word.card.sessionId]}
            terms={[word.term]}
            everyCard
            title={word.term}
            onClose={() => setPractising(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
