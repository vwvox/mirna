import { updateLessonDocument, useLessonDocument } from "./documents";
import { emptyLessonFixes, parseLessonFixes } from "./schema";
import type { LessonFixesDocument, LessonFormula } from "./types";

export function useLessonFixes(
  sessionId: string | null | undefined,
): LessonFixesDocument | null {
  return useLessonDocument(sessionId, "lesson_fixes", parseLessonFixes);
}

/** Saves the formula as the student checked or corrected it. */
export function setFormulaFix(
  sessionId: string,
  name: string,
  latex: string,
  now = new Date(),
): Promise<LessonFixesDocument> {
  return updateLessonDocument(
    sessionId,
    "lesson_fixes",
    parseLessonFixes,
    emptyLessonFixes,
    (current) => ({
      ...current,
      formulas: {
        ...current.formulas,
        [name]: { latex: latex.trim(), at: now.toISOString() },
      },
    }),
  );
}

export type ShownFormula = LessonFormula & {
  /** Rebuilt from speech and not yet looked at by the student. */
  needsCheck: boolean;
  /** The student checked or corrected it. */
  checked: boolean;
};

/** The sheet's formulas with the student's fixes laid over them. */
export function applyFormulaFixes(
  formulas: readonly LessonFormula[],
  fixes: LessonFixesDocument | null,
): ShownFormula[] {
  return formulas.map((formula) => {
    const fix = fixes?.formulas[formula.name];
    return {
      ...formula,
      latex: fix?.latex || formula.latex,
      checked: Boolean(fix),
      needsCheck: formula.from === "speech" && !fix,
    };
  });
}
