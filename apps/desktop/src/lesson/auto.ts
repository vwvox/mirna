import type { LanguageModel } from "ai";
import { create } from "zustand";

import { loadLessonDocument } from "./documents";
import { generateLessonSheet, prepareLessonSheet } from "./generate";
import { loadLessonSession } from "./queries";
import { parseLessonSheetDocument } from "./schema";

export type LessonSheetStatus =
  | { state: "writing" }
  | { state: "error"; message: string };

export const useLessonSheetStatus = create<{
  bySession: Record<string, LessonSheetStatus>;
}>(() => ({ bySession: {} }));

function setStatus(sessionId: string, status: LessonSheetStatus | null) {
  useLessonSheetStatus.setState((current) => {
    const bySession = { ...current.bySession };
    if (status) bySession[sessionId] = status;
    else delete bySession[sessionId];
    return { bySession };
  });
}

const inFlight = new Map<string, Promise<void>>();

function modelNameOf(model: LanguageModel) {
  return typeof model === "string" ? model : model.modelId;
}

/**
 * Writes the study sheet of a lesson note. With `force` unset it skips a lesson whose
 * sheet was already written from the same transcript, marks and notes.
 */
export function requestLessonSheet(
  sessionId: string,
  model: LanguageModel | null,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const running = inFlight.get(sessionId);
  if (running) return running;

  const task = (async () => {
    const lesson = await loadLessonSession(sessionId);
    if (!lesson.isLesson || !lesson.settings) return;
    if (!model) {
      setStatus(sessionId, {
        state: "error",
        message:
          "Pick a model in Settings › Intelligence to write the study sheet.",
      });
      return;
    }
    const input = {
      sessionId,
      settings: lesson.settings,
      folderPath: lesson.folderPath,
    };
    const prepared = await prepareLessonSheet(input);
    if (!prepared) return;
    if (!force) {
      const existing = await loadLessonDocument(
        sessionId,
        "lesson_sheet",
        parseLessonSheetDocument,
      );
      if (existing?.sourceHash === prepared.sourceHash) return;
    }
    setStatus(sessionId, { state: "writing" });
    await generateLessonSheet({
      model,
      input,
      prepared,
      modelName: modelNameOf(model),
    });
    setStatus(sessionId, null);
  })()
    .catch((error: unknown) => {
      console.error(
        "[lesson] study sheet failed",
        error,
        (error as { cause?: unknown } | null)?.cause,
      );
      setStatus(sessionId, {
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => inFlight.delete(sessionId));

  inFlight.set(sessionId, task);
  return task;
}
