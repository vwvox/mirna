import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  Copy,
  DownloadSimple,
  GraduationCap,
  PencilSimple,
  Warning,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import { useLessonDocument } from "../documents";
import {
  buildFormulaLatex,
  buildSubjectMarkdown,
  exportCards,
  subjectCardItems,
} from "../export";
import {
  applyFormulaFixes,
  setFormulaFix,
  type ShownFormula,
  useLessonFixes,
} from "../fixes";
import { practiceCardId, setWordCard } from "../practice";
import { useCourseSheets } from "../queries";
import { parseLessonPractice } from "../schema";
import { sourcesHeading } from "../subject-sheet";
import { formatClock } from "../time";
import type { LessonSheet, LessonSourceKind, LessonSubject } from "../types";
import { Formula, MathText } from "./math";
import {
  Badge,
  Corrections,
  PlayButton,
  RailPanel,
  Section,
  usePlayAt,
} from "./sheet-parts";
import { openCourse } from "./sidebar-courses";

/** The sections of a topic or maths sheet, in the order that kind of class needs. */
export function SubjectSections({
  sessionId,
  sheet,
  subject,
  firstLessonOf,
}: {
  sessionId: string;
  sheet: LessonSheet;
  subject: LessonSubject;
  firstLessonOf: ReadonlyMap<string, number>;
}) {
  const topic = (
    <>
      <KeyTerms
        sessionId={sessionId}
        sheet={sheet}
        firstLessonOf={firstLessonOf}
      />
      <Ideas sessionId={sessionId} sheet={sheet} />
      <Sources sessionId={sessionId} sheet={sheet} />
      <Methods sessionId={sessionId} sheet={sheet} />
      <CheckYourself sessionId={sessionId} sheet={sheet} />
    </>
  );
  const maths = (
    <>
      <Formulas sessionId={sessionId} sheet={sheet} />
      <WorkedExamples sessionId={sessionId} sheet={sheet} />
      <Corrections sessionId={sessionId} sheet={sheet} variant="subject" />
      <Problems sheet={sheet} />
    </>
  );
  return subject === "maths" ? (
    <>
      {maths}
      {topic}
    </>
  ) : (
    <>
      {topic}
      {maths}
    </>
  );
}

function useCardToggle(sessionId: string) {
  const { t } = useLingui();
  const practice = useLessonDocument(
    sessionId,
    "lesson_practice",
    parseLessonPractice,
  );
  const skipped = new Set(practice?.skipped ?? []);
  return {
    isOn: (id: string) => !skipped.has(id),
    set: (id: string, on: boolean) =>
      void setWordCard(sessionId, id, on).catch(() =>
        toast.error(t`Couldn't save that.`),
      ),
  };
}

function KeyTerms({
  sessionId,
  sheet,
  firstLessonOf,
}: {
  sessionId: string;
  sheet: LessonSheet;
  firstLessonOf: ReadonlyMap<string, number>;
}) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  const cards = useCardToggle(sessionId);
  if (sheet.keyTerms.length === 0) return null;
  const fresh = sheet.keyTerms.filter((item) => item.isNew).length;
  return (
    <Section
      title={<Trans>Key terms</Trans>}
      note={
        <Trans>
          {fresh} new · {sheet.keyTerms.length - fresh} you met before
        </Trans>
      }
    >
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                <Trans>Term</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>In the teacher's words</Trans>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <Trans>Explained at</Trans>
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium">
                <Trans>Cards</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.keyTerms.map((item) => {
              const earlier = firstLessonOf.get(item.term);
              const id = practiceCardId("term", item.term);
              return (
                <tr key={item.term} className="border-t align-top">
                  <td className="text-mirna-serra dark:text-mirna-moss px-4 py-3 text-base font-bold whitespace-nowrap">
                    {item.term}
                  </td>
                  <td className="px-3 py-3 leading-relaxed">
                    {item.definition}
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
                  <td className="px-3 py-3">
                    {item.heardAtMs !== null ? (
                      <PlayButton
                        label={t`Hear ${item.term} explained`}
                        time={item.heardAtMs}
                        disabled={!canPlay}
                        playing={isMomentPlaying(item.heardAtMs, 15)}
                        onClick={() => playFrom(item.heardAtMs!, 15)}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      className="accent-mirna-serra size-4"
                      aria-label={t`Make a card for ${item.term}`}
                      checked={cards.isOn(id)}
                      onChange={(event) => cards.set(id, event.target.checked)}
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

function Ideas({ sessionId, sheet }: { sessionId: string; sheet: LessonSheet }) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  if (sheet.ideas.length === 0) return null;
  return (
    <Section
      title={<Trans>Main ideas</Trans>}
      note={
        sheet.ideas.length === 1 ? (
          <Trans>1, as it came up</Trans>
        ) : (
          <Trans>{sheet.ideas.length}, in the order they came up</Trans>
        )
      }
    >
      <ol className="flex flex-col gap-3">
        {sheet.ideas.map((idea, index) => (
          <li
            key={`${idea.title}-${index}`}
            className="grid grid-cols-[34px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border p-4"
          >
            <span
              aria-hidden="true"
              className="font-brand text-mirna-serra dark:text-mirna-moss text-2xl leading-none"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <b className="text-base">{idea.title}</b>
              {idea.explanation ? (
                <p className="text-sm leading-relaxed">{idea.explanation}</p>
              ) : null}
            </div>
            {idea.example ? (
              <div className="bg-mirna-mist/70 dark:bg-muted col-start-2 flex items-start gap-3 rounded-lg px-3 py-2 text-sm leading-relaxed">
                <div className="flex-1">
                  <span className="text-muted-foreground block text-[11px] font-semibold tracking-wide uppercase">
                    <Trans>Example used in class</Trans>
                  </span>
                  {idea.example}
                </div>
                {idea.exampleAtMs !== null ? (
                  <PlayButton
                    label={t`Play the example`}
                    time={idea.exampleAtMs}
                    disabled={!canPlay}
                    playing={isMomentPlaying(idea.exampleAtMs, 20)}
                    onClick={() => playFrom(idea.exampleAtMs!, 20)}
                  />
                ) : null}
              </div>
            ) : null}
            {idea.terms.length > 0 ? (
              <div className="text-muted-foreground col-start-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Trans>Uses</Trans>
                {idea.terms.map((term) => (
                  <span
                    key={term}
                    className="rounded-pill bg-mirna-moss/60 text-mirna-serra dark:bg-mirna-serra/30 dark:text-mirna-moss border px-2 py-0.5 font-semibold"
                  >
                    {term}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function useSourceKindLabels(): Record<LessonSourceKind, string> {
  const { t } = useLingui();
  return {
    person: t`Person`,
    book: t`Book`,
    case: t`Case`,
    law: t`Law`,
    study: t`Study`,
    other: t`Source`,
  };
}

function Sources({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const labels = useSourceKindLabels();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  if (sheet.sources.length === 0) return null;
  const heading = sourcesHeading(sheet.sources);
  return (
    <Section
      title={
        heading === "cases" ? (
          <Trans>Cases and laws</Trans>
        ) : (
          <Trans>People and sources</Trans>
        )
      }
      note={<Trans>who and what was cited</Trans>}
    >
      <ul className="flex flex-col gap-2">
        {sheet.sources.map((source, index) => (
          <li
            key={`${source.name}-${index}`}
            className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border px-4 py-3"
          >
            <span
              className={cn([
                "rounded-pill mt-0.5 w-fit px-2 py-0.5 text-[11px] font-semibold",
                source.kind === "person"
                  ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
                  : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
              ])}
            >
              {labels[source.kind]}
            </span>
            <div className="flex flex-col gap-0.5">
              <b className={cn(["text-sm", source.kind === "case" && "italic"])}>
                {source.name}
                {source.year ? (
                  <span className="text-muted-foreground ml-1.5 font-normal not-italic">
                    {source.year}
                  </span>
                ) : null}
              </b>
              {source.note ? (
                <p className="text-sm leading-relaxed">{source.note}</p>
              ) : null}
            </div>
            {source.atMs !== null ? (
              <PlayButton
                label={t`Play where it came up`}
                time={source.atMs}
                disabled={!canPlay}
                playing={isMomentPlaying(source.atMs, 20)}
                onClick={() => playFrom(source.atMs!, 20)}
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

function StepList({
  sessionId,
  steps,
}: {
  sessionId: string;
  steps: { text: string; atMs: number | null }[];
}) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step, index) => (
        <li
          key={index}
          className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-2.5"
        >
          <span
            aria-hidden="true"
            className="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss flex size-6 items-center justify-center rounded-pill text-xs font-bold"
          >
            {index + 1}
          </span>
          {step.text.includes("$") ? (
            <MathText
              text={step.text}
              className="pt-0.5 text-sm leading-relaxed"
            />
          ) : (
            <QuantityText
              text={step.text}
              className="pt-0.5 text-sm leading-relaxed"
            />
          )}
          {step.atMs !== null ? (
            <PlayButton
              label={t`Play step ${index + 1}`}
              time={step.atMs}
              disabled={!canPlay}
              playing={isMomentPlaying(step.atMs, 15)}
              onClick={() => playFrom(step.atMs!, 15)}
            />
          ) : (
            <span />
          )}
        </li>
      ))}
    </ol>
  );
}

const QUANTITY =
  /\d+(?:[.,]\d+)?(?:\s?(?:ml|l|g|kg|mg|cl|dl|°C|°F|cm|mm|min|minutes|hours?|tbsp|tsp|tablespoons?|teaspoons?|cups?|pinch(?:es)?)\b)/giu;

/** A step with its quantities, temperatures and times in bold, as a recipe card would. */
export function QuantityText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(QUANTITY)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), bold: false });
    parts.push({ text: match[0], bold: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.bold ? <b key={index}>{part.text}</b> : part.text,
      )}
    </span>
  );
}

function Methods({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  if (sheet.methods.length === 0) return null;
  return (
    <Section title={<Trans>Steps and methods</Trans>}>
      {sheet.methods.map((method, index) => (
        <div
          key={`${method.title}-${index}`}
          className="flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="text-muted-foreground text-sm">
            <b className="text-foreground">{method.title}</b>
            {method.atMs !== null ? (
              <>
                {" "}
                ·{" "}
                <Trans>
                  from{" "}
                  <span className="font-mono">{formatClock(method.atMs)}</span>
                </Trans>
              </>
            ) : null}
          </div>
          <StepList sessionId={sessionId} steps={method.steps} />
        </div>
      ))}
    </Section>
  );
}

function CheckYourself({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  if (sheet.checkYourself.length === 0) return null;
  return (
    <Section
      title={<Trans>Check yourself</Trans>}
      note={<Trans>answered from the class; open one to see</Trans>}
    >
      <div className="flex flex-col gap-2">
        {sheet.checkYourself.map((item, index) => (
          <details
            key={`${item.question}-${index}`}
            className="group rounded-xl border"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-orange-100 text-xs font-bold text-orange-900 dark:bg-orange-900/40 dark:text-orange-100"
              >
                ?
              </span>
              <MathText text={item.question} className="flex-1" />
              <span className="text-muted-foreground text-xs group-open:hidden">
                <Trans>Show</Trans>
              </span>
              <span className="text-muted-foreground hidden text-xs group-open:inline">
                <Trans>Hide</Trans>
              </span>
            </summary>
            <div className="flex items-start gap-3 px-4 pb-4 pl-13 text-sm leading-relaxed">
              <MathText text={item.answer} className="flex-1" />
              {item.atMs !== null ? (
                <PlayButton
                  label={t`Hear it explained`}
                  time={item.atMs}
                  disabled={!canPlay}
                  playing={isMomentPlaying(item.atMs, 20)}
                  onClick={() => playFrom(item.atMs!, 20)}
                />
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Formulas({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const fixes = useLessonFixes(sessionId);
  const formulas = useMemo(
    () => applyFormulaFixes(sheet.formulas, fixes),
    [fixes, sheet.formulas],
  );
  if (formulas.length === 0) return null;
  const toCheck = formulas.filter((formula) => formula.needsCheck).length;
  return (
    <Section
      title={<Trans>Formulas</Trans>}
      note={
        toCheck > 0 ? (
          <Trans>
            {formulas.length} from this class · {toCheck} to check
          </Trans>
        ) : (
          <Trans>{formulas.length} from this class</Trans>
        )
      }
    >
      <div id="lesson-formulas" className="grid gap-3 sm:grid-cols-2">
        {formulas.map((formula) => (
          <FormulaCard
            key={formula.name}
            sessionId={sessionId}
            formula={formula}
          />
        ))}
      </div>
    </Section>
  );
}

function FormulaCard({
  sessionId,
  formula,
}: {
  sessionId: string;
  formula: ShownFormula;
}) {
  const { t } = useLingui();
  const { canPlay, playFrom, isMomentPlaying } = usePlayAt(sessionId);
  const [editing, setEditing] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const save = useMutation({
    mutationFn: (latex: string) => setFormulaFix(sessionId, formula.name, latex),
    onSuccess: () => setEditing(null),
    onError: () => toast.error(t`Couldn't save that.`),
  });
  const wide = editing !== null || formula.needsCheck;
  return (
    <div
      className={cn([
        "flex min-w-0 flex-col gap-2.5 rounded-xl border p-4",
        wide && "sm:col-span-2",
        formula.needsCheck &&
          "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20",
      ])}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{formula.name}</b>
        <span
          className={cn([
            "rounded-pill ml-auto px-2 py-0.5 text-[11px] font-semibold",
            formula.needsCheck
              ? "border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
              : "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-moss",
          ])}
        >
          {formula.checked ? (
            <Trans>Checked by you</Trans>
          ) : formula.from === "notes" ? (
            <Trans>From your notes</Trans>
          ) : (
            <Trans>Rebuilt from what was said · check it</Trans>
          )}
        </span>
      </div>
      {formula.needsCheck && editing === null ? (
        <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-950 dark:text-amber-100">
          <Warning className="mt-0.5 size-4 shrink-0" />
          <span>
            <Trans>
              Rebuilt from what the teacher said, without a slide to read. Check
              it against your notes and fix it here if it's not what you saw.
            </Trans>
          </span>
        </p>
      ) : null}
      {editing !== null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-muted-foreground flex flex-col gap-1.5 text-xs font-semibold">
            LaTeX
            <textarea
              autoFocus
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              className="bg-background text-foreground min-h-24 rounded-lg border px-3 py-2 font-mono text-sm font-normal"
            />
          </label>
          <div className="text-muted-foreground flex flex-col gap-1.5 text-xs font-semibold">
            <Trans>Preview</Trans>
            <div className="bg-mirna-mist/50 dark:bg-muted text-foreground flex min-h-24 items-center justify-center rounded-lg px-3 py-3 text-lg font-normal">
              <Formula latex={editing} display />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-mirna-mist/50 dark:bg-muted flex min-h-20 items-center justify-center overflow-x-auto rounded-lg px-3 py-3 text-xl">
          <Formula
            latex={formula.latex}
            display
            label={formula.name}
            onBroken={setBroken}
          />
        </div>
      )}
      {formula.symbols.length > 0 && editing === null ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {formula.symbols.map((item) => (
            <div key={item.symbol} className="contents">
              <dt className="min-w-7 text-center">
                <Formula latex={item.symbol} />
              </dt>
              <dd className="leading-snug">{item.meaning}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {formula.whenToUse && editing === null ? (
        <p className="bg-mirna-mist/70 dark:bg-muted rounded-lg px-3 py-2 text-sm leading-relaxed">
          {formula.whenToUse}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {formula.atMs !== null ? (
          <PlayButton
            label={t`Hear it explained`}
            time={formula.atMs}
            disabled={!canPlay}
            playing={isMomentPlaying(formula.atMs, 20)}
            onClick={() => playFrom(formula.atMs!, 20)}
          />
        ) : null}
        {editing !== null ? (
          <>
            <Button
              size="sm"
              disabled={!editing.trim() || save.isPending}
              onClick={() => save.mutate(editing)}
            >
              <Trans>Save</Trans>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              <Trans>Cancel</Trans>
            </Button>
          </>
        ) : (
          <>
            {formula.needsCheck ? (
              <Button
                size="sm"
                disabled={save.isPending || broken}
                onClick={() => save.mutate(formula.latex)}
              >
                <Trans>Looks right</Trans>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={broken ? "default" : "outline"}
              onClick={() => setEditing(formula.latex)}
            >
              <PencilSimple className="size-3.5" />
              {broken ? <Trans>Fix it</Trans> : <Trans>Edit</Trans>}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard
                  .writeText(formula.latex)
                  .then(() => toast.success(t`Copied the LaTeX`))
              }
            >
              <Trans>Copy LaTeX</Trans>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function WorkedExamples({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  if (sheet.workedExamples.length === 0) return null;
  return (
    <Section
      title={<Trans>Worked examples</Trans>}
      note={
        sheet.workedExamples.length === 1 ? (
          <Trans>1, as done in class</Trans>
        ) : (
          <Trans>{sheet.workedExamples.length}, as done in class</Trans>
        )
      }
    >
      {sheet.workedExamples.map((example, index) => (
        <div
          key={`${example.problem}-${index}`}
          className="flex flex-col gap-3.5 rounded-xl border p-4"
        >
          <div className="text-sm leading-relaxed">
            <span className="text-muted-foreground block text-xs font-semibold tracking-wide uppercase">
              {example.atMs !== null ? (
                <Trans>
                  Example {index + 1} · from{" "}
                  <span className="font-mono">{formatClock(example.atMs)}</span>
                </Trans>
              ) : (
                <Trans>Example {index + 1}</Trans>
              )}
            </span>
            <MathText text={example.problem} className="text-base" />
          </div>
          <StepList sessionId={sessionId} steps={example.steps} />
          {example.answer ? (
            <div className="bg-mirna-moss/50 dark:bg-mirna-serra/30 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold">
              <Trans>Answer</Trans>
              <MathText text={example.answer} className="font-medium" />
            </div>
          ) : null}
        </div>
      ))}
    </Section>
  );
}

function Problems({ sheet }: { sheet: LessonSheet }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  if (sheet.problems.length === 0) return null;
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <Section title={<Trans>Practice problems</Trans>}>
      <ol className="flex flex-col gap-2">
        {sheet.problems.map((problem, index) => (
          <li
            key={`${problem.question}-${index}`}
            className="flex flex-col gap-2 rounded-xl border px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-orange-100 text-xs font-bold text-orange-900 dark:bg-orange-900/40 dark:text-orange-100"
              >
                {index + 1}
              </span>
              <div className="flex-1 text-sm leading-relaxed">
                <MathText text={problem.question} />
                {problem.atMs !== null ? (
                  <span className="text-muted-foreground block text-xs">
                    <Trans>
                      Set in class at{" "}
                      <span className="font-mono">
                        {formatClock(problem.atMs)}
                      </span>
                    </Trans>
                  </span>
                ) : null}
              </div>
              {problem.answer || problem.steps.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={open.has(index)}
                  onClick={() => toggle(index)}
                >
                  {open.has(index) ? (
                    <Trans>Hide answer</Trans>
                  ) : (
                    <Trans>Show answer</Trans>
                  )}
                </Button>
              ) : null}
            </div>
            {open.has(index) ? (
              <div className="flex flex-col gap-1.5 pl-9 text-sm leading-relaxed">
                {problem.steps.map((step, stepIndex) => (
                  <MathText key={stepIndex} text={step} />
                ))}
                {problem.answer ? (
                  <b>
                    <MathText text={problem.answer} />
                  </b>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Formulas rebuilt from speech and not yet checked, first in the rail as on the board. */
export function FormulaCheckPanel({
  sessionId,
  sheet,
}: {
  sessionId: string;
  sheet: LessonSheet;
}) {
  const { t } = useLingui();
  const fixes = useLessonFixes(sessionId);
  const toCheck = applyFormulaFixes(sheet.formulas, fixes).filter(
    (formula) => formula.needsCheck,
  );
  if (toCheck.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h3 className="text-[11px] font-semibold tracking-wider text-amber-900 uppercase dark:text-amber-100">
        {toCheck.length === 1
          ? t`Check 1 formula`
          : t`Check ${toCheck.length} formulas`}
      </h3>
      <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-100">
        <Trans>
          Rebuilt from what the teacher said, with nothing written to read.
          Compare with your notes.
        </Trans>
      </p>
      {toCheck.map((formula) => (
        <button
          key={formula.name}
          type="button"
          onClick={() =>
            document
              .getElementById("lesson-formulas")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="bg-background hover:bg-accent flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium"
        >
          {formula.name}
          {formula.atMs !== null ? (
            <span className="text-muted-foreground font-mono text-xs">
              {formatClock(formula.atMs)}
            </span>
          ) : null}
        </button>
      ))}
    </section>
  );
}

/** The course glossary or formula sheet, counted across the course's sheets. */
export function SubjectCoursePanel({
  folderPath,
  subject,
}: {
  folderPath: string;
  subject: LessonSubject;
}) {
  const { t } = useLingui();
  const sheets = useCourseSheets(folderPath);
  let terms = 0;
  let formulas = 0;
  let lessons = 0;
  const seenTerms = new Set<string>();
  const seenFormulas = new Set<string>();
  for (const document of sheets.values()) {
    lessons++;
    for (const item of document.sheet.keyTerms) seenTerms.add(item.term);
    for (const item of document.sheet.formulas) seenFormulas.add(item.name);
  }
  terms = seenTerms.size;
  formulas = seenFormulas.size;
  const showFormulas = subject === "maths" || (formulas > 0 && terms === 0);
  const count = showFormulas ? formulas : terms;
  if (count === 0) return null;
  return (
    <RailPanel
      title={showFormulas ? t`Course formula sheet` : t`Course glossary`}
    >
      <span className="font-brand text-mirna-serra dark:text-mirna-moss text-3xl leading-none font-medium">
        {count}
      </span>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {showFormulas ? (
          lessons === 1 ? (
            <Trans>formulas from 1 lesson, on one page.</Trans>
          ) : (
            <Trans>formulas across {lessons} lessons, on one page.</Trans>
          )
        ) : lessons === 1 ? (
          <Trans>key terms from 1 lesson, each linked to where it was explained.</Trans>
        ) : (
          <Trans>
            key terms across {lessons} lessons, each linked to where it was
            explained.
          </Trans>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => openCourse(folderPath)}
      >
        <GraduationCap className="size-3.5" />
        {showFormulas ? (
          <Trans>Open the formula sheet</Trans>
        ) : (
          <Trans>Open the glossary</Trans>
        )}
      </Button>
    </RailPanel>
  );
}

export function SubjectTakeElsewhere({
  sessionId,
  sheet,
  lessonTitle,
}: {
  sessionId: string;
  sheet: LessonSheet;
  lessonTitle: string;
}) {
  const { t } = useLingui();
  const fixes = useLessonFixes(sessionId);
  const formulas = useMemo(
    () => applyFormulaFixes(sheet.formulas, fixes),
    [fixes, sheet.formulas],
  );
  const items = subjectCardItems(sheet, formulas, lessonTitle);
  const anki = useMutation({
    mutationFn: () => exportCards(items, lessonTitle),
    onSuccess: (path) => {
      if (path) toast.success(t`Saved ${path}`);
    },
    onError: () => toast.error(t`Couldn't save the file.`),
  });
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error(t`Couldn't copy it.`);
    }
  };
  const row =
    "hover:bg-accent flex items-center justify-between rounded-lg border bg-white/60 px-3 py-2 text-left text-sm font-medium dark:bg-transparent";
  return (
    <RailPanel title={t`Take it elsewhere`}>
      {items.length > 0 ? (
        <button type="button" onClick={() => anki.mutate()} className={row}>
          <Trans>Anki deck</Trans>
          <span className="text-muted-foreground flex items-center gap-1 text-xs font-normal">
            <DownloadSimple className="size-3" />
            {formulas.length > 0 ? (
              <Trans>formulas render there</Trans>
            ) : (
              <Trans>term and definition</Trans>
            )}
          </span>
        </button>
      ) : null}
      {formulas.length > 0 ? (
        <button
          type="button"
          className={row}
          onClick={() =>
            void copy(
              buildFormulaLatex(lessonTitle, formulas),
              t`Copied the formulas as LaTeX`,
            )
          }
        >
          <Trans>Copy as LaTeX</Trans>
          <Copy className="text-muted-foreground size-3" />
        </button>
      ) : null}
      <button
        type="button"
        className={row}
        onClick={() =>
          void copy(
            buildSubjectMarkdown(lessonTitle, sheet, formulas),
            t`Copied the sheet as Markdown`,
          )
        }
      >
        <Trans>Copy as Markdown</Trans>
        <Copy className="text-muted-foreground size-3" />
      </button>
    </RailPanel>
  );
}
