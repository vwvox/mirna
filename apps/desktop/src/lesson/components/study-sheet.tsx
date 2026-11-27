import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ArrowsClockwise, DownloadSimple } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { requestLessonSheet, useLessonSheetStatus } from "../auto";
import { useLessonDocument } from "../documents";
import { exportVocabulary, type VocabularyExportFormat } from "../export";
import { computeTalkStats } from "../generate";
import { computeLanguageStats, languageShare } from "../language";
import { LessonLanguageProvider } from "../language-context";
import {
  languageName,
  readingHeading,
  splitArticle,
  usesPinyin,
} from "../languages";
import { useLessonMarks } from "../marks";
import { setWordCard } from "../practice";
import { usePracticeDue } from "../practice-data";
import {
  useCourseLessons,
  useCourseSheets,
  useLessonSession,
  useLessonSheet,
} from "../queries";
import { LastReview, ReviewButton } from "../review/review-button";
import { lessonSubject, parseLessonPractice } from "../schema";
import type { LessonSettings, LessonSheet } from "../types";
import { useLessonTranscript } from "../use-lesson-segments";
import { LessonPracticeDialog } from "./practice-dialog";
import {
  Badge,
  Banner,
  Corrections,
  formatMinutes,
  Homework,
  Marks,
  NextClass,
  PlayButton,
  RailPanel,
  Section,
  sheetTable,
  usePlayAt,
  useSheetClipTracker,
} from "./sheet-parts";
import { openCourse } from "./sidebar-courses";
import {
  FormulaCheckPanel,
  SubjectCoursePanel,
  SubjectSections,
  SubjectTakeElsewhere,
} from "./subject-sections";
import { LessonTerm } from "./term";
import { ToneLegend } from "./tone-legend";

import { useLanguageModel } from "~/ai/hooks";
import { ChineseDisplayMenu } from "~/session/components/note-input/transcript/display-menu";
import { useSession } from "~/session/queries";
import { hasHan } from "~/stt/pinyin";

export { useMarkLabels } from "./sheet-parts";

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
      for (const item of [
        ...document.sheet.vocabulary,
        ...document.sheet.keyTerms,
      ]) {
        const known = first.get(item.term);
        if (known === undefined || number < known) first.set(item.term, number);
      }
    }
    return first;
  }, [courseSheets, lessonNumber, numberOf, sessionId]);

  const write = () =>
    void requestLessonSheet(sessionId, model, { force: true });

  if (!lesson.isLesson) return null;
  const settings = lesson.settings;
  const subject = lessonSubject(settings);
  const language = settings?.learning ?? null;
  const sheet = sheetDocument?.sheet ?? null;
  const isSubjectSheet = sheet?.kind === "subject";
  const courseName = lesson.folderPath.split("/").pop() || lesson.folderPath;
  const title = sheet?.topic || session?.title || t`Lesson`;
  const started = row?.started_at || row?.created_at || session?.created_at;
  const audioMs = Number(row?.audio_ms ?? 0);
  const hasCards = isSubjectSheet
    ? sheet.keyTerms.length +
        sheet.checkYourself.length +
        sheet.formulas.length +
        sheet.problems.length >
      0
    : (sheet?.vocabulary.length ?? 0) > 0;

  return (
    <LessonLanguageProvider language={language}>
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
              {subject === "language" ? (
                <Trans>
                  When the lesson's summary is ready, the AI picked in Settings
                  › Intelligence writes its study sheet here: words, patterns,
                  corrections and homework.
                </Trans>
              ) : subject === "maths" ? (
                <Trans>
                  When the lesson's summary is ready, the AI picked in Settings
                  › Intelligence writes its study sheet here: formulas, worked
                  examples, problems and homework.
                </Trans>
              ) : (
                <Trans>
                  When the lesson's summary is ready, the AI picked in Settings
                  › Intelligence writes its study sheet here: key terms, ideas,
                  sources and homework.
                </Trans>
              )}
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
                  <SubjectLine settings={settings} />
                  <LastReview sessionId={sessionId} />
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
                {!isSubjectSheet && usesPinyin(language) ? (
                  <ChineseDisplayMenu
                    lesson
                    label={t`Pinyin and tones`}
                    triggerClassName="h-8 px-3 text-sm"
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={write}
                  disabled={!model || status?.state === "writing"}
                >
                  <ArrowsClockwise className="size-3.5" />
                  <Trans>Write again</Trans>
                </Button>
                <ReviewButton
                  sessionId={sessionId}
                  title={session?.title || t`This lesson`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPractising(true)}
                  disabled={practice.due === 0}
                >
                  {practice.due > 0 ? (
                    <Trans>Practise {practice.due} cards</Trans>
                  ) : hasCards ? (
                    <Trans>All practised for now</Trans>
                  ) : (
                    <Trans>Nothing to practise</Trans>
                  )}
                </Button>
              </div>
            </header>

            {/* Beside the sheet only when the note's pane has room for both. */}
            <div className="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="@container flex min-w-0 flex-col gap-8">
                <p className="font-brand text-xl leading-relaxed">
                  {sheet.summary}
                </p>
                {isSubjectSheet ? (
                  <SubjectSections
                    sessionId={sessionId}
                    sheet={sheet}
                    subject={subject}
                    firstLessonOf={firstLessonOf}
                  />
                ) : (
                  <>
                    <Words
                      sessionId={sessionId}
                      sheet={sheet}
                      language={language}
                      firstLessonOf={firstLessonOf}
                    />
                    <Patterns sessionId={sessionId} sheet={sheet} />
                    <Corrections sessionId={sessionId} sheet={sheet} />
                  </>
                )}
                <Marks sessionId={sessionId} sheet={sheet} marks={marks} />
                <Homework sessionId={sessionId} sheet={sheet} />
              </div>
              <aside
                aria-label={t`Lesson at a glance`}
                className="flex flex-col gap-3.5 @4xl:sticky @4xl:top-2 @4xl:self-start"
              >
                {isSubjectSheet ? (
                  <FormulaCheckPanel sessionId={sessionId} sheet={sheet} />
                ) : null}
                <ThisLesson
                  sessionId={sessionId}
                  sheet={sheet}
                  settings={isSubjectSheet ? null : settings}
                  previousId={previous?.id}
                  previousNumber={
                    lessonNumber !== null ? lessonNumber - 1 : null
                  }
                />
                <RailPanel title={t`Practise`}>
                  <span className="font-brand text-mirna-serra dark:text-mirna-moss text-3xl leading-none font-medium">
                    {practice.due - practice.fromOtherLessons}
                  </span>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {isSubjectSheet ? (
                      <Trans>
                        cards from this lesson, each linked to where the teacher
                        explained it.
                      </Trans>
                    ) : (
                      <Trans>
                        cards from this lesson, each with your teacher's voice.
                      </Trans>
                    )}{" "}
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
                {isSubjectSheet && lesson.folderPath ? (
                  <SubjectCoursePanel
                    folderPath={lesson.folderPath}
                    subject={subject}
                  />
                ) : null}
                {lesson.folderPath ? (
                  <NextClass
                    folderPath={lesson.folderPath}
                    lessonIds={practiceIds}
                  />
                ) : null}
                {isSubjectSheet ? (
                  <SubjectTakeElsewhere
                    sessionId={sessionId}
                    sheet={sheet}
                    lessonTitle={session?.title || t`Lesson`}
                  />
                ) : (
                  <TakeElsewhere
                    sheet={sheet}
                    language={language}
                    lessonTitle={session?.title || t`Lesson`}
                  />
                )}
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
    </LessonLanguageProvider>
  );
}

/** "Language lesson", "Topic lesson · Sociology" or "Maths & science lesson". */
function SubjectLine({ settings }: { settings: LessonSettings | null }) {
  const { i18n } = useLingui();
  const subject = lessonSubject(settings);
  const name = settings?.subjectName?.trim();
  if (subject === "language") {
    if (!settings) return null;
    const learning = languageName(settings.learning, i18n.locale);
    const explainIn = languageName(settings.explainIn, i18n.locale);
    return (
      <span>
        <Trans>
          {learning} lesson · explained in {explainIn}
        </Trans>
      </span>
    );
  }
  return (
    <span>
      {subject === "maths" ? (
        <Trans>Maths &amp; science lesson</Trans>
      ) : (
        <Trans>Topic lesson</Trans>
      )}
      {name ? ` · ${name}` : null}
    </span>
  );
}

function Words({
  sessionId,
  sheet,
  language,
  firstLessonOf,
}: {
  sessionId: string;
  sheet: LessonSheet;
  language: string | null;
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
  const showReading = sheet.vocabulary.some((item) => item.reading);
  const showType = sheet.vocabulary.some((item) => item.note);
  const readingTitle = {
    pinyin: t`Pinyin`,
    kana: t`Kana`,
    reading: t`Reading`,
  }[readingHeading(language)];
  return (
    <Section
      title={<Trans>Words</Trans>}
      note={
        <Trans>
          {fresh} new · {sheet.vocabulary.length - fresh} from earlier lessons
        </Trans>
      }
    >
      {usesPinyin(language) &&
      sheet.vocabulary.some((item) => hasHan(item.term)) ? (
        <ToneLegend />
      ) : null}
      <div className={sheetTable.frame}>
        <table className={sheetTable.table}>
          <thead className={sheetTable.head}>
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                <Trans>Word</Trans>
              </th>
              {showReading ? (
                <th scope="col" className="px-3 py-2 font-medium">
                  {readingTitle}
                </th>
              ) : null}
              {showType ? (
                <th scope="col" className="px-3 py-2 font-medium">
                  <Trans>Type</Trans>
                </th>
              ) : null}
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Meaning</Trans>
              </th>
              <th
                scope="col"
                className={cn(["px-3 py-2 font-medium", sheetTable.playColumn])}
              >
                <Trans>Teacher says it</Trans>
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium">
                <Trans>Cards</Trans>
              </th>
            </tr>
          </thead>
          <tbody className={sheetTable.body}>
            {sheet.vocabulary.map((item) => {
              const earlier = firstLessonOf.get(item.term);
              return (
                <tr key={item.term} className={sheetTable.row}>
                  <td
                    className={cn([
                      usesPinyin(language) && hasHan(item.term)
                        ? "px-4 py-2 text-2xl"
                        : "px-4 py-2 text-lg font-semibold",
                      sheetTable.first,
                    ])}
                  >
                    <WordTerm
                      term={item.term}
                      reading={item.reading}
                      language={language}
                    />
                  </td>
                  {showReading ? (
                    <td className={cn(["px-3 py-2", sheetTable.below])}>
                      {item.reading}
                    </td>
                  ) : null}
                  {showType ? (
                    <td
                      className={cn([
                        "text-muted-foreground px-3 py-2 text-xs whitespace-nowrap",
                        sheetTable.below,
                      ])}
                    >
                      {item.note}
                    </td>
                  ) : null}
                  <td className={cn(["px-3 py-2", sheetTable.below])}>
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
                  <td className={cn(["px-3 py-2", sheetTable.play])}>
                    <PlayButton
                      label={t`Play the teacher saying ${item.term}`}
                      time={item.heardAtMs}
                      disabled={!canPlay}
                      playing={isTermPlaying(item.term)}
                      onClick={() => playTerm(item.term, item.heardAtMs)}
                    />
                  </td>
                  <td
                    className={cn(["px-3 py-2 text-center", sheetTable.card])}
                  >
                    <input
                      type="checkbox"
                      className="accent-mirna-serra size-4"
                      aria-label={t`Make a card for ${item.term}`}
                      title={t`Make a card for ${item.term}`}
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

/** A word as the sheet lists it: Chinese with its display, other nouns with the article lighter. */
function WordTerm({
  term,
  reading,
  language,
}: {
  term: string;
  reading: string;
  language: string | null;
}) {
  const parts = splitArticle(term, language);
  if (!parts) return <LessonTerm term={term} reading={reading} />;
  return (
    <span lang={language ?? undefined}>
      <span className="text-muted-foreground font-normal">{parts.article}</span>
      {/^l['’]$/iu.test(parts.article) ? "" : " "}
      {parts.rest}
    </span>
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
      <div className="grid gap-3 @xl:grid-cols-2">
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

/** Who talked, and for language lessons how much was in the language, from the transcript. */
function ThisLesson({
  sessionId,
  sheet,
  settings,
  previousId,
  previousNumber,
}: {
  sessionId: string;
  sheet: LessonSheet;
  /** Null for subject lessons, which have no language share. */
  settings: LessonSettings | null;
  previousId: string | undefined;
  previousNumber: number | null;
}) {
  const { t, i18n } = useLingui();
  const { segments, roleOf, ready } = useLessonTranscript(sessionId);
  const before = useLessonTranscript(settings ? previousId : undefined);
  const learning = settings?.learning ?? null;
  const explainIn = settings?.explainIn ?? null;
  const talk = useMemo(
    () => (ready ? computeTalkStats(segments, roleOf) : sheet.talk),
    [ready, roleOf, segments, sheet.talk],
  );
  const stats = useMemo(
    () =>
      ready && learning && explainIn
        ? computeLanguageStats(segments, roleOf, { learning, explainIn })
        : null,
    [explainIn, learning, ready, roleOf, segments],
  );
  const shareBefore = useMemo(() => {
    if (!before.ready || !learning || !explainIn) return null;
    const result = computeLanguageStats(before.segments, before.roleOf, {
      learning,
      explainIn,
    });
    return result ? languageShare(result) : null;
  }, [before.ready, before.roleOf, before.segments, explainIn, learning]);
  if (!talk && !stats) return null;
  const spoke = talk
    ? Math.round((talk.studentMs / (talk.studentMs + talk.teacherMs)) * 100)
    : null;
  const share = stats ? languageShare(stats) : null;
  const name = settings ? languageName(settings.learning, i18n.locale) : "";
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
      {share !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">
              <Trans>In {name}</Trans>
            </span>
            <span className="font-mono text-xs">{share}%</span>
          </div>
          <div
            className="bg-muted rounded-pill h-2 overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="bg-mirna-terra block h-full"
              style={{ width: `${share}%` }}
            />
          </div>
          {shareBefore !== null && previousNumber ? (
            <span className="text-muted-foreground text-xs">
              {share >= shareBefore ? (
                <Trans>
                  Up from {shareBefore}% in lesson {previousNumber}
                </Trans>
              ) : (
                <Trans>
                  Down from {shareBefore}% in lesson {previousNumber}
                </Trans>
              )}
            </span>
          ) : null}
        </div>
      ) : null}
      {stats && spoke !== null ? (
        <div className="flex justify-between text-sm">
          <span className="font-semibold">
            <Trans>Your {name}</Trans>
          </span>
          <span className="font-mono text-xs">
            {formatMinutes(stats.studentInLanguageMs)}
          </span>
        </div>
      ) : null}
    </RailPanel>
  );
}

function TakeElsewhere({
  sheet,
  language,
  lessonTitle,
}: {
  sheet: LessonSheet;
  language: string | null;
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
  const formats: [VocabularyExportFormat, string][] = [["anki", t`Anki deck`]];
  if (usesPinyin(language)) formats.push(["pleco", t`Pleco flashcards`]);
  return (
    <RailPanel title={t`Take it elsewhere`}>
      {formats.map(([format, name]) => (
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
