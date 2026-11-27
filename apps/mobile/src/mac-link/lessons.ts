// Lessons between this phone and the Mac: what the phone says a recording is
// (a lesson or a note), the teacher clips it fetches for the sheet and the
// review, and the reviews it plays, which go back for the Mac to count.
// The Mac does all the work; the phone keeps, shows and plays.
import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { execute, executeTransaction } from "@/db";
import {
  afterUpload,
  clipChanges,
  type LessonClips,
  type LessonTagState,
  parseMacLesson,
  parseTagState,
  queueReview,
  reviewBatches,
  settingsFromTag,
} from "@/lesson/lesson-model";
import type { ReviewRun } from "@/lesson/review-plan";
import { logDiagnostic, logDiagnosticError } from "@/lib/diagnostics";
import { nowIso } from "@/lib/ids";

import * as bridge from "./bridge";
import { LinkError } from "./bridge";
import type { LessonTag } from "./model";
import { loadReviewOutbox, updateReviewOutbox } from "./schedule";
import { setMacLinkStatus } from "./status";

type Connection = Parameters<typeof bridge.noteJob>[0];

// --- A lesson or a note: this phone's choice --------------------------------

export async function loadLessonTag(
  sessionId: string,
): Promise<LessonTagState | null> {
  const [row] = await execute<{ tag: string | null }>(
    `SELECT json_extract(metadata_json, '$.lesson_tag') AS tag
      FROM sessions WHERE id = ? AND deleted_at IS NULL`,
    [sessionId],
  );
  return parseTagState(row?.tag);
}

/**
 * Says what a recording made on this phone is. Saved here at once; the Mac
 * hears it with the recording, or at the next sync if it has it already.
 * A lesson shows as one here straight away, with the Mac's settings shape.
 */
export async function saveLessonTag(
  sessionId: string,
  lesson: LessonTag | null,
): Promise<LessonTagState> {
  const [row] = await execute<{ kind: string | null; tag: string | null }>(
    `SELECT kind, json_extract(metadata_json, '$.lesson_tag') AS tag
      FROM sessions WHERE id = ? AND deleted_at IS NULL`,
    [sessionId],
  );
  const previous = parseTagState(row?.tag);
  // A note that never was a lesson has nothing to undo on the Mac.
  const nothingToTell =
    lesson === null && row?.kind !== "lesson" && !previous?.lesson;
  const state: LessonTagState = {
    lesson,
    sent: nothingToTell,
    at: nowIso(),
  };
  const now = nowIso();
  await executeTransaction([
    lesson
      ? {
          sql: `UPDATE sessions
            SET kind = 'lesson',
              metadata_json = json_set(COALESCE(metadata_json, '{}'),
                '$.lesson', json(?), '$.lesson_tag', json(?)),
              updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
          params: [
            JSON.stringify(settingsFromTag(lesson)),
            JSON.stringify(state),
            now,
            sessionId,
          ],
        }
      : {
          sql: `UPDATE sessions
            SET kind = 'meeting',
              metadata_json = json_set(
                json_remove(COALESCE(metadata_json, '{}'), '$.lesson'),
                '$.lesson_tag', json(?)),
              updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
          params: [JSON.stringify(state), now, sessionId],
        },
  ]);
  logDiagnostic("lesson_tag_saved", {
    lesson: lesson !== null,
    subject: lesson?.subject ?? null,
    sent: state.sent,
  });
  return state;
}

/** The Mac has the choice made at `at` (a later one still has to go). */
export async function markLessonTagSent(sessionId: string, at: string) {
  await executeTransaction([
    {
      sql: `UPDATE sessions
        SET metadata_json = json_set(metadata_json, '$.lesson_tag.sent', json('true'))
        WHERE id = ? AND deleted_at IS NULL
          AND json_extract(metadata_json, '$.lesson_tag.at') = ?`,
      params: [sessionId, at],
    },
  ]);
}

const PENDING_TAGS_SQL = `
SELECT session.id AS session_id,
  json_extract(session.metadata_json, '$.lesson_tag') AS tag,
  json_extract(attachment.metadata_json, '$.mac_link.state') AS state
FROM sessions AS session
JOIN session_attachments AS attachment
  ON attachment.id = 'session-audio:' || session.id AND attachment.deleted_at IS NULL
WHERE session.deleted_at IS NULL
  AND json_extract(session.metadata_json, '$.lesson_tag.sent') = 0
LIMIT 20
`;

/**
 * Tells the Mac about lesson choices made after it had the recording. One it
 * can't take now (it's working on the note) goes at a later sync.
 */
export async function sendPendingLessonTags(connection: Connection) {
  const rows = await execute<{
    session_id: string;
    tag: string | null;
    state: string | null;
  }>(PENDING_TAGS_SQL, []);
  for (const row of rows) {
    const tag = parseTagState(row.tag);
    // Not on the Mac yet: the choice goes with the recording.
    if (
      !tag ||
      !row.state ||
      row.state === "waiting" ||
      row.state === "sending"
    ) {
      continue;
    }
    try {
      const reply = await bridge.noteJob(connection, row.session_id, {
        type: "set_lesson",
        lesson: tag.lesson,
      });
      await markLessonTagSent(row.session_id, tag.at);
      if (reply.status.job) {
        await setMacLinkStatus(row.session_id, {
          state: "on_mac",
          job: reply.status.job.type,
          mac_session_id: reply.status.session_id,
        });
      }
      logDiagnostic("lesson_tag_sent", {
        lesson: tag.lesson !== null,
        state: reply.status.state,
      });
    } catch (error) {
      if (error instanceof LinkError && error.code === "unreachable")
        throw error;
      const reason = bridge.refusalReason(error);
      if (
        reason === "busy" ||
        reason === "not_ready" ||
        reason === "no_audio"
      ) {
        continue;
      }
      logDiagnosticError(
        "lesson_tag_refused",
        error,
        { old_mac: bridge.isUnknownRequest(error) },
        "warning",
      );
    }
  }
}

// --- Teacher clips ----------------------------------------------------------

function clipsDirectory(sessionId: string) {
  return new Directory(Paths.document, "sessions", sessionId, "clips");
}

export function clipFile(sessionId: string, clipId: string) {
  return new File(
    Paths.document,
    "sessions",
    sessionId,
    "clips",
    `${clipId}.mp3`,
  );
}

/** The clip's file when it's on this phone. */
export function clipUri(sessionId: string, clipId: string): string | null {
  try {
    const file = clipFile(sessionId, clipId);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

let clipsVersion = 0;
const clipsListeners = new Set<() => void>();

/** Changes whenever clips arrive, so the sheet shows their play buttons. */
export function useClipsVersion() {
  return useSyncExternalStore(
    (listener) => {
      clipsListeners.add(listener);
      return () => clipsListeners.delete(listener);
    },
    () => clipsVersion,
  );
}

const LESSON_CLIPS_SQL = `
SELECT id AS session_id, created_at,
  json_extract(metadata_json, '$.mac_lesson') AS mac_lesson
FROM sessions
WHERE deleted_at IS NULL AND kind = 'lesson'
  AND json_extract(metadata_json, '$.mac_lesson') IS NOT NULL
`;

/** Clips fetched in one sync at most; the next sync carries on. */
const CLIPS_PER_SYNC = 200;

function clipNames(sessionId: string): string[] {
  const directory = clipsDirectory(sessionId);
  if (!directory.exists) return [];
  return directory
    .list()
    .filter((entry) => entry instanceof File)
    .map((entry) => entry.name);
}

/**
 * Fetches the clips of the newest lessons that aren't here yet, and clears
 * clips no plan plays any more and those of older lessons.
 */
export async function downloadLessonClips(connection: Connection) {
  const rows = await execute<{
    session_id: string;
    created_at: string;
    mac_lesson: string | null;
  }>(LESSON_CLIPS_SQL, []);
  const lessons: LessonClips[] = [];
  const macIds = new Map<string, string>();
  const present = new Map<string, string[]>();
  for (const row of rows) {
    const mac = parseMacLesson(row.mac_lesson);
    if (!mac) continue;
    lessons.push({
      session_id: row.session_id,
      created_at: row.created_at,
      clips: mac.clips,
    });
    macIds.set(row.session_id, mac.mac_session_id);
    present.set(row.session_id, clipNames(row.session_id));
  }
  const changes = clipChanges(lessons, present);

  for (const sessionId of changes.clearLessons) {
    try {
      clipsDirectory(sessionId).delete();
    } catch (error) {
      console.warn("[mac-link] could not clear clips", error);
    }
  }
  for (const file of changes.removeFiles) {
    try {
      new File(clipsDirectory(file.session_id), file.name).delete();
    } catch (error) {
      console.warn("[mac-link] could not remove a clip", error);
    }
  }

  let fetched = 0;
  let bytes = 0;
  let failed = 0;
  for (const { session_id, clip } of changes.download.slice(
    0,
    CLIPS_PER_SYNC,
  )) {
    const macSessionId = macIds.get(session_id);
    if (!macSessionId) continue;
    try {
      const reply = await bridge.downloadClip(connection, {
        sessionId: macSessionId,
        clipId: clip.id,
        file: clipFile(session_id, clip.id).uri,
        sha256: clip.sha256,
      });
      fetched += 1;
      bytes += reply.size;
    } catch (error) {
      if (error instanceof LinkError && error.code === "unreachable") break;
      failed += 1;
      if (failed === 1) {
        logDiagnosticError("lesson_clip_failed", error, {}, "warning");
      }
    }
  }
  if (
    fetched > 0 ||
    changes.removeFiles.length > 0 ||
    changes.clearLessons.length > 0
  ) {
    clipsVersion += 1;
    for (const listener of clipsListeners) listener();
  }
  if (fetched > 0 || failed > 0) {
    logDiagnostic("lesson_clips_fetched", { fetched, bytes, failed });
  }
}

// --- Reviews played here ----------------------------------------------------

/** Keeps a finished review on this phone until the Mac has it. */
export function queuePhoneReview(input: {
  sessionId: string;
  macSessionId: string;
  run: ReviewRun;
}) {
  return updateReviewOutbox((outbox) =>
    queueReview(outbox, {
      session_id: input.sessionId,
      mac_session_id: input.macSessionId,
      run: input.run,
      sent_at: null,
    }),
  );
}

/** Sends the reviews waiting on this phone; the Mac counts each one once. */
export async function sendQueuedReviews(connection: Connection) {
  const outbox = await loadReviewOutbox();
  if (outbox.length === 0) return;
  const accepted: string[] = [];
  const dropped: string[] = [];
  for (const batch of reviewBatches(outbox)) {
    try {
      const reply = await bridge.sendReviews(
        connection,
        batch.mac_session_id,
        batch.entries.map((entry) => JSON.stringify(entry.run)),
      );
      accepted.push(...reply.accepted);
    } catch (error) {
      if (error instanceof LinkError && error.code === "unreachable") break;
      const reason = bridge.refusalReason(error);
      // The note is gone from the Mac, or isn't a lesson there any more.
      if (reason === "unknown_note" || reason === "not_a_lesson") {
        dropped.push(...batch.entries.map((entry) => entry.run.id));
      }
      logDiagnosticError(
        "lesson_reviews_refused",
        error,
        { reason },
        "warning",
      );
    }
  }
  const counted = await countedReviewIds([
    ...new Set(outbox.map((entry) => entry.session_id)),
  ]);
  await updateReviewOutbox((current) =>
    afterUpload(current, { accepted, dropped, counted, now: new Date() }),
  );
  if (accepted.length > 0) {
    logDiagnostic("lesson_reviews_sent", { count: accepted.length });
  }
}

/** Reviews the Mac says it has counted, for these lessons. */
async function countedReviewIds(sessionIds: string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const rows = await execute<{ mac_lesson: string | null }>(
    `SELECT json_extract(metadata_json, '$.mac_lesson') AS mac_lesson
      FROM sessions WHERE id IN (${sessionIds.map(() => "?").join(", ")})`,
    sessionIds,
  );
  return rows.flatMap(
    (row) =>
      parseMacLesson(row.mac_lesson)?.reviews.map((review) => review.id) ?? [],
  );
}
