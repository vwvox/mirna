import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import {
  type ClipCut,
  type LessonInfo,
  commands as phoneLinkCommands,
  type PublishedCourse,
  type PublishedLesson,
} from "@anlg/plugin-phone-link";

import { executeTransaction, liveQueryClient } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { loadLessonDocument } from "~/lesson/documents";
import { markSessionAsLesson } from "~/lesson/queries";
import { segmentClipSource } from "~/lesson/review/clip-source";
import { parseReviewPlanDocument } from "~/lesson/review/document";
import { clipOf } from "~/lesson/review/drafts";
import { recordReviewRun } from "~/lesson/review/results";
import type { ReviewClip, ReviewPlan, ReviewRun } from "~/lesson/review/types";
import {
  parseLessonPractice,
  parseLessonSettings,
  parseLessonSheetDocument,
} from "~/lesson/schema";
import { defaultLessonTitle } from "~/lesson/title";
import type { LessonSettings, LessonSheet } from "~/lesson/types";
import { loadLessonTranscript } from "~/lesson/use-lesson-segments";
import { createNamedFolder } from "~/session/folder-catalog";
import { updateSession } from "~/session/queries";

/** A course is a folder; its name is the folder's last part. */
export function courseName(folderPath: string): string {
  return folderPath.split("/").pop() || folderPath;
}

export function settingsOf(lesson: LessonInfo): LessonSettings {
  const subject =
    lesson.subject === "topic" || lesson.subject === "maths"
      ? lesson.subject
      : "language";
  return {
    learning: lesson.learning,
    explainIn: lesson.explain_in,
    subject,
    ...(lesson.subject_name?.trim()
      ? { subjectName: lesson.subject_name.trim() }
      : {}),
  };
}

async function lessonCount(folderPath: string): Promise<number> {
  const rows = await liveQueryClient.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sessions
     WHERE folder_path = ? AND kind = 'lesson' AND deleted_at IS NULL`,
    [folderPath],
  );
  return Number(rows[0]?.count ?? 0);
}

/** The folder a phone's course name means, made when it's new. */
async function ensureCourse(name: string): Promise<string> {
  const rows = await liveQueryClient.execute<{ folder_path: string }>(
    `SELECT folder_path FROM sessions
     WHERE kind = 'lesson' AND deleted_at IS NULL AND folder_path <> ''
     GROUP BY folder_path`,
    [],
  );
  const wanted = name.trim();
  const found = rows.find(
    (row) => courseName(row.folder_path).toLowerCase() === wanted.toLowerCase(),
  );
  if (found) return found.folder_path;
  try {
    return await createNamedFolder(wanted);
  } catch (error) {
    // Already there as a folder without lessons: use it.
    console.warn("[phone-link] course folder", error);
    return wanted;
  }
}

/** The title a recording the phone called nothing gets in its course. */
export async function nextLessonTitle(lesson: LessonInfo): Promise<string> {
  const folder = await ensureCourse(lesson.course);
  return defaultLessonTitle((await lessonCount(folder)) + 1);
}

/** Files a note as a lesson in the course the phone named. */
export async function fileAsLesson(
  sessionId: string,
  lesson: LessonInfo,
): Promise<void> {
  const folder = await ensureCourse(lesson.course);
  await updateSession(sessionId, { folder_id: folder });
  await markSessionAsLesson(sessionId, settingsOf(lesson));
}

/** Makes a lesson a normal note again; its sheet and review stay, unused. */
export function unfileLesson(sessionId: string): Promise<void> {
  return enqueueDatabaseWrite(`lesson-session:${sessionId}`, async () => {
    await executeTransaction([
      {
        sql: `
          UPDATE sessions
          SET kind = 'meeting',
            metadata_json = CASE WHEN json_valid(metadata_json)
              THEN json_remove(metadata_json, '$.lesson') ELSE metadata_json END,
            updated_at = ?
          WHERE id = ? AND kind = 'lesson' AND deleted_at IS NULL
        `,
        params: [new Date().toISOString(), sessionId],
      },
    ]);
  });
}

/** Every course with lessons, for the phone's course picker. */
export async function publishCourses(): Promise<void> {
  const rows = await liveQueryClient.execute<{
    folder_path: string;
    lessons: number;
    lesson: string | null;
  }>(
    `SELECT folder_path, COUNT(*) AS lessons,
       (SELECT json_extract(latest.metadata_json, '$.lesson') FROM sessions AS latest
        WHERE latest.folder_path = sessions.folder_path AND latest.kind = 'lesson'
          AND latest.deleted_at IS NULL
        ORDER BY COALESCE(NULLIF(latest.started_at, ''), latest.created_at) DESC
        LIMIT 1) AS lesson
     FROM sessions
     WHERE kind = 'lesson' AND deleted_at IS NULL AND folder_path <> ''
     GROUP BY folder_path`,
    [],
  );
  const courses: PublishedCourse[] = [];
  for (const row of rows) {
    const settings = parseLessonSettings(row.lesson);
    if (!settings) continue;
    courses.push({
      name: courseName(row.folder_path),
      subject: settings.subject ?? "language",
      learning: settings.learning,
      explain_in: settings.explainIn,
      subject_name: settings.subjectName ?? null,
      next_number: Number(row.lessons) + 1,
    });
  }
  const result = await phoneLinkCommands.publishCourses(courses);
  if (result.status === "error") throw new Error(result.error);
}

/** Every clip a review plan plays. */
export function planClips(plan: ReviewPlan): ReviewClip[] {
  const clips: ReviewClip[] = [];
  for (const piece of plan.pieces) {
    clips.push(...piece.clips);
    if (piece.body.type === "choice" && piece.body.listen) {
      clips.push(piece.body.listen);
    }
    if (piece.body.type === "cards") {
      for (const item of piece.body.items) if (item.clip) clips.push(item.clip);
    }
  }
  return clips;
}

/**
 * The clips the phone's study sheet plays, by what they belong to:
 * `word:<term>`, `example:<text>`, `slip:<said>`, `term:<term>`.
 */
export function sheetClips(
  sheet: LessonSheet,
  clips: ReturnType<typeof segmentClipSource>,
): Record<string, ReviewClip> {
  const map: Record<string, ReviewClip> = {};
  const put = (key: string, clip: ReviewClip | null) => {
    if (clip && !map[key]) map[key] = clip;
  };
  for (const word of sheet.vocabulary) {
    put(`word:${word.term}`, clipOf(clips.term(word.term, word.heardAtMs), ""));
  }
  for (const pattern of sheet.patterns) {
    for (const example of pattern.examples) {
      put(
        `example:${example.text}`,
        clipOf(clips.speech(example.atMs, 8_000), ""),
      );
    }
  }
  for (const slip of sheet.corrections) {
    put(`slip:${slip.said}`, clipOf(clips.correction(slip.atMs).teacher, ""));
  }
  for (const term of sheet.keyTerms) {
    put(`term:${term.term}`, clipOf(clips.speech(term.heardAtMs, 15_000), ""));
  }
  return map;
}

const LESSON_SQL = `
  SELECT kind, folder_path, json_extract(metadata_json, '$.lesson') AS lesson
  FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1
`;

/**
 * What a phone needs of a lesson: its settings, sheet, review plan, the clips
 * they play (cut from the recording) and the reviews counted so far. Null
 * for a note that isn't a lesson.
 */
export async function lessonForPhone(
  sessionId: string,
): Promise<PublishedLesson | null> {
  const rows = await liveQueryClient.execute<{
    kind: string | null;
    folder_path: string | null;
    lesson: string | null;
  }>(LESSON_SQL, [sessionId]);
  const row = rows[0];
  if (row?.kind !== "lesson" || !row.lesson) return null;
  const settings = parseLessonSettings(row.lesson);
  if (!settings) return null;
  const folder = row.folder_path ?? "";
  const [sheetDocument, reviewDocument, practice] = await Promise.all([
    loadLessonDocument(sessionId, "lesson_sheet", parseLessonSheetDocument),
    loadLessonDocument(sessionId, "lesson_review", parseReviewPlanDocument),
    loadLessonDocument(sessionId, "lesson_practice", parseLessonPractice),
  ]);

  let number: number | null = null;
  if (folder) {
    const order = await liveQueryClient.execute<{ id: string }>(
      `SELECT id FROM sessions WHERE folder_path = ? AND kind = 'lesson'
         AND deleted_at IS NULL
       ORDER BY COALESCE(NULLIF(started_at, ''), created_at) ASC`,
      [folder],
    );
    const index = order.findIndex((entry) => entry.id === sessionId);
    number = index >= 0 ? index + 1 : null;
  }

  const wanted = new Map<string, ReviewClip>();
  let byItem: Record<string, ReviewClip> = {};
  if (sheetDocument) {
    try {
      const transcript = await loadLessonTranscript(sessionId);
      byItem = sheetClips(
        sheetDocument.sheet,
        segmentClipSource(transcript.segments, transcript.roleOf),
      );
    } catch (error) {
      console.warn("[phone-link] no clips for the sheet", error);
    }
  }
  for (const clip of Object.values(byItem)) wanted.set(clip.id, clip);
  if (reviewDocument) {
    for (const clip of planClips(reviewDocument.plan))
      wanted.set(clip.id, clip);
  }

  let clips: PublishedLesson["clips"] = [];
  if (wanted.size > 0) {
    const audio = await fsSyncCommands.audioPath(sessionId);
    if (audio.status === "ok") {
      const cuts: ClipCut[] = [...wanted.values()].map((clip) => ({
        id: clip.id,
        start_ms: clip.startMs,
        end_ms: clip.endMs,
        channel: clip.channel,
      }));
      const exported = await phoneLinkCommands.exportClips(
        sessionId,
        audio.data,
        cuts,
      );
      if (exported.status === "ok") clips = exported.data;
      else console.warn("[phone-link] clips", exported.error);
    }
  }

  return {
    settings_json: JSON.stringify(settings),
    course: folder ? courseName(folder) : null,
    number,
    sheet_json: sheetDocument
      ? JSON.stringify({ ...sheetDocument, clips: byItem })
      : null,
    review_json: reviewDocument ? JSON.stringify(reviewDocument) : null,
    clips,
    reviews: (practice?.reviews ?? []).slice(-20).map((review) => ({
      id: review.id,
      ended_at: review.endedAt,
      device: review.device,
      length: review.length,
      right: review.right,
      total: review.total,
    })),
  };
}

function parseRun(json: string): ReviewRun | null {
  try {
    const run = JSON.parse(json) as Partial<ReviewRun>;
    if (
      typeof run.id !== "string" ||
      typeof run.startedAt !== "string" ||
      typeof run.endedAt !== "string" ||
      (run.length !== 5 && run.length !== 10) ||
      !Array.isArray(run.results)
    ) {
      return null;
    }
    const results = run.results.filter(
      (result) =>
        result &&
        typeof result.pieceId === "string" &&
        typeof result.kind === "string" &&
        (result.outcome === "missed" ||
          result.outcome === "shaky" ||
          result.outcome === "knew"),
    );
    return {
      id: run.id,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      length: run.length,
      device: "phone",
      planHash: typeof run.planHash === "string" ? run.planHash : "",
      results: results.map((result) => ({
        pieceId: result.pieceId,
        kind: result.kind,
        outcome: result.outcome,
        cardId: typeof result.cardId === "string" ? result.cardId : null,
        markId: typeof result.markId === "string" ? result.markId : null,
        ...(Array.isArray(result.cards)
          ? {
              cards: result.cards.filter(
                (card) =>
                  card &&
                  typeof card.cardId === "string" &&
                  typeof card.knew === "boolean",
              ),
            }
          : {}),
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Counts the reviews phones played into each lesson's practice, once each.
 * Returns whether any lesson changed, so the phones can be told.
 */
export async function countPhoneReviews(): Promise<boolean> {
  const pending = await phoneLinkCommands.listReviews();
  if (pending.status === "error") throw new Error(pending.error);
  let changed = false;
  for (const review of pending.data) {
    const run = parseRun(review.run_json);
    if (run) {
      const exists = await liveQueryClient.execute<{ id: string }>(
        "SELECT id FROM sessions WHERE id = ? AND kind = 'lesson' AND deleted_at IS NULL",
        [review.session_id],
      );
      if (exists.length > 0) {
        await recordReviewRun(review.session_id, run);
        changed = true;
      }
    }
    await phoneLinkCommands.removeReview(review.session_id, review.id);
  }
  return changed;
}
