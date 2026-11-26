import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

import { Copy } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

import type { CourseLesson } from "../course-data";
import { buildFormulaLatex } from "../export";
import { applyFormulaFixes, type ShownFormula } from "../fixes";
import { sourcesHeading } from "../subject-sheet";
import type { LessonSource } from "../types";
import { Formula } from "./math";

type CourseFormula = ShownFormula & { lessonNumber: number };

/** Every formula in the course, the latest version of each, oldest lesson first. */
export function courseFormulas(lessons: CourseLesson[]): CourseFormula[] {
  const byName = new Map<string, CourseFormula>();
  for (const lesson of lessons) {
    const shown = applyFormulaFixes(
      lesson.sheet?.sheet.formulas ?? [],
      lesson.fixes,
    );
    for (const formula of shown) {
      const earlier = byName.get(formula.name);
      byName.set(formula.name, {
        ...formula,
        lessonNumber: earlier?.lessonNumber ?? lesson.number,
      });
    }
  }
  return [...byName.values()];
}

/** The course's formulas on one page, to revise from or copy into a document. */
export function CourseFormulaSheet({
  lessons,
  courseName,
}: {
  lessons: CourseLesson[];
  courseName: string;
}) {
  const { t } = useLingui();
  const formulas = useMemo(() => courseFormulas(lessons), [lessons]);
  if (formulas.length === 0) return null;
  const toCheck = formulas.filter((formula) => formula.needsCheck).length;
  return (
    <section aria-labelledby="course-formulas" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          id="course-formulas"
          className="font-brand flex items-baseline gap-2 text-lg font-medium"
        >
          <Trans>Formula sheet</Trans>
          <span className="text-muted-foreground font-sans text-sm font-normal">
            {formulas.length}
          </span>
        </h2>
        {toCheck > 0 ? (
          <span className="text-xs text-amber-900 dark:text-amber-200">
            {toCheck === 1 ? (
              <Trans>1 still to check on its lesson's sheet</Trans>
            ) : (
              <Trans>{toCheck} still to check on their lessons' sheets</Trans>
            )}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() =>
            void navigator.clipboard
              .writeText(buildFormulaLatex(courseName, formulas))
              .then(() => toast.success(t`Copied the formulas as LaTeX`))
              .catch(() => toast.error(t`Couldn't copy it.`))
          }
        >
          <Copy className="size-3.5" />
          <Trans>Copy as LaTeX</Trans>
        </Button>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {formulas.map((formula) => (
          <li
            key={formula.name}
            className={cn([
              "flex min-w-0 flex-col gap-2 rounded-xl border p-3.5",
              formula.needsCheck &&
                "border-amber-300 dark:border-amber-700",
            ])}
          >
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-sm">{formula.name}</b>
              <span className="text-muted-foreground font-mono text-[11px]">
                L{formula.lessonNumber}
              </span>
            </div>
            <div className="bg-mirna-mist/50 dark:bg-muted flex min-h-16 items-center justify-center overflow-x-auto rounded-lg px-2 py-2">
              <Formula latex={formula.latex} display label={formula.name} />
            </div>
            {formula.whenToUse ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {formula.whenToUse}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** People, books, cases and laws cited across the course, with the lesson that first cited each. */
export function CourseSources({ lessons }: { lessons: CourseLesson[] }) {
  const sources = useMemo(() => {
    const byName = new Map<string, LessonSource & { lessonNumber: number }>();
    for (const lesson of lessons) {
      for (const source of lesson.sheet?.sheet.sources ?? []) {
        if (!byName.has(source.name))
          byName.set(source.name, { ...source, lessonNumber: lesson.number });
      }
    }
    return [...byName.values()];
  }, [lessons]);
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby="course-sources" className="flex flex-col gap-3">
      <h2
        id="course-sources"
        className="font-brand flex items-baseline gap-2 text-lg font-medium"
      >
        {sourcesHeading(sources) === "cases" ? (
          <Trans>Cases and laws</Trans>
        ) : (
          <Trans>People and sources</Trans>
        )}
        <span className="text-muted-foreground font-sans text-sm font-normal">
          {sources.length}
        </span>
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <li
            key={source.name}
            className="flex flex-col gap-0.5 rounded-xl border px-3.5 py-2.5"
          >
            <b
              className={cn(["text-sm", source.kind === "case" && "italic"])}
            >
              {source.name}
              {source.year ? (
                <span className="text-muted-foreground ml-1.5 font-normal not-italic">
                  {source.year}
                </span>
              ) : null}
            </b>
            {source.note ? (
              <span className="text-sm leading-relaxed">{source.note}</span>
            ) : null}
            <span className="text-muted-foreground font-mono text-[11px]">
              L{source.lessonNumber}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
