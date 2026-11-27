import { useLessonDocument } from "../documents";
import type { ReviewPlanDocument } from "./types";

/**
 * A stored review plan. The plan is written by this app's own code, so only
 * its outline is checked; a plan from an older version is ignored and made
 * again.
 */
export function parseReviewPlanDocument(
  raw: unknown,
): ReviewPlanDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const document = raw as Partial<ReviewPlanDocument>;
  const plan = document.plan;
  if (!plan || plan.version !== 1 || !Array.isArray(plan.pieces)) return null;
  return {
    plan,
    generatedAt: String(document.generatedAt ?? ""),
    model: typeof document.model === "string" ? document.model : null,
    sourceHash: String(document.sourceHash ?? ""),
  };
}

export function useReviewPlan(
  sessionId: string | null | undefined,
): ReviewPlanDocument | null {
  return useLessonDocument(
    sessionId ?? "",
    "lesson_review",
    parseReviewPlanDocument,
  );
}
