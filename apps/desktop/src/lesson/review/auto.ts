import type { LanguageModel } from "ai";
import { create } from "zustand";

import { loadLessonDocument, writeLessonDocument } from "../documents";
import { loadLessonSession } from "../queries";
import {
  lessonSubject,
  parseLessonFixes,
  parseLessonMarks,
  parseLessonPractice,
  parseLessonSheetDocument,
} from "../schema";
import { loadLessonTranscript } from "../use-lesson-segments";
import {
  NO_CLIPS,
  type ReviewClipSource,
  segmentClipSource,
} from "./clip-source";
import { parseReviewPlanDocument } from "./document";
import { lessonDrafts, type ReviewDraft } from "./drafts";
import { assemblePlan } from "./plan";
import {
  REVIEW_PROMPT_VERSION,
  reviewMaterial,
  writeReviewPieces,
  writtenDrafts,
} from "./written";

import { sha256Hex } from "~/session/attachments";

export const useReviewPlanStatus = create<{
  bySession: Record<string, "writing">;
}>(() => ({ bySession: {} }));

function setWriting(sessionId: string, writing: boolean) {
  useReviewPlanStatus.setState((current) => {
    const bySession = { ...current.bySession };
    if (writing) bySession[sessionId] = "writing";
    else delete bySession[sessionId];
    return { bySession };
  });
}

const inFlight = new Map<string, Promise<void>>();

function modelNameOf(model: LanguageModel | null): string | null {
  if (!model) return null;
  return typeof model === "string" ? model : model.modelId;
}

/**
 * Makes a lesson's review plan and keeps it with the lesson: at once from the
 * sheet alone, then again with the pieces the AI writes when a model is
 * picked. Skipped when the sheet, marks and model haven't changed.
 */
export function requestReviewPlan(
  sessionId: string,
  model: LanguageModel | null,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const running = inFlight.get(sessionId);
  if (running) return running;
  const task = makePlan(sessionId, model, force)
    .catch((error: unknown) => {
      console.error("[lesson] review plan failed", error);
    })
    .finally(() => {
      inFlight.delete(sessionId);
      setWriting(sessionId, false);
    });
  inFlight.set(sessionId, task);
  return task;
}

async function makePlan(
  sessionId: string,
  model: LanguageModel | null,
  force: boolean,
) {
  const lesson = await loadLessonSession(sessionId);
  if (!lesson.isLesson || !lesson.settings) return;
  const sheetDocument = await loadLessonDocument(
    sessionId,
    "lesson_sheet",
    parseLessonSheetDocument,
  );
  if (!sheetDocument) return;
  const [marks, practice, fixes, existing] = await Promise.all([
    loadLessonDocument(sessionId, "lesson_marks", parseLessonMarks),
    loadLessonDocument(sessionId, "lesson_practice", parseLessonPractice),
    loadLessonDocument(sessionId, "lesson_fixes", parseLessonFixes),
    loadLessonDocument(sessionId, "lesson_review", parseReviewPlanDocument),
  ]);
  const subject = lessonSubject(lesson.settings);
  const modelName = modelNameOf(model);
  const markKey = (marks?.marks ?? []).map((mark) => [
    mark.id,
    mark.kind,
    mark.atMs,
    mark.note,
  ]);
  const hashOf = (withModel: string | null) =>
    sha256Hex(
      new TextEncoder().encode(
        `${REVIEW_PROMPT_VERSION}\n${withModel ?? "none"}\n${JSON.stringify({
          sheet: sheetDocument.sheet,
          marks: markKey,
          settings: lesson.settings,
        })}`,
      ).buffer as ArrayBuffer,
    );
  const fullHash = await hashOf(modelName);
  if (!force && existing?.sourceHash === fullHash) return;

  let clips: ReviewClipSource;
  try {
    const transcript = await loadLessonTranscript(sessionId);
    clips = segmentClipSource(transcript.segments, transcript.roleOf);
  } catch {
    clips = NO_CLIPS;
  }
  const input = {
    sheet: sheetDocument.sheet,
    settings: lesson.settings,
    subject,
    marks,
    practice,
    fixes,
    clips,
    teacher: "",
    now: new Date(),
  };
  const own = lessonDrafts(input);
  const build = (drafts: ReviewDraft[]) =>
    assemblePlan({
      subject,
      learning: lesson.settings!.learning,
      explainIn: lesson.settings!.explainIn,
      drafts,
    });

  const writePlan = (
    drafts: ReviewDraft[],
    withModel: string | null,
    sourceHash: string,
  ) =>
    writeLessonDocument(
      sessionId,
      "lesson_review",
      {
        plan: build(drafts),
        generatedAt: new Date().toISOString(),
        model: withModel,
        sourceHash,
      },
      sourceHash,
    );

  // A plan from the sheet alone, so Review works straight away.
  const basicHash = await hashOf(null);
  if (!model) {
    if (force || existing?.sourceHash !== basicHash) {
      await writePlan(own, null, basicHash);
    }
    return;
  }
  if (
    force ||
    !existing ||
    (existing.sourceHash !== basicHash && existing.sourceHash !== fullHash)
  ) {
    await writePlan(own, null, basicHash);
  }

  setWriting(sessionId, true);
  const written = await writeReviewPieces({
    model,
    sheet: sheetDocument.sheet,
    subject,
    subjectName: lesson.settings.subjectName ?? "",
    explainIn: lesson.settings.explainIn,
  });
  const { ids } = reviewMaterial(sheetDocument.sheet);
  const extra = writtenDrafts(written, {
    sheet: sheetDocument.sheet,
    subject,
    ids,
    clips,
    teacher: "",
  });
  await writePlan([...extra, ...own], modelName, fullHash);
}
