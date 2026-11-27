import { useLiveQuery } from "@/db";
import type { MacLesson } from "@/mac-link/model";

import {
  type LessonSettings,
  type LessonTagState,
  parseMacLesson,
  parseSettings,
  parseTagState,
} from "./lesson-model";
import {
  parseReviewPlanDocument,
  type ReviewPlanDocument,
} from "./review-plan";
import { parseSheetDocument, type PhoneSheetDocument } from "./sheet";

/** A note's lesson on this phone: what the Mac made of it, or what was said. */
export type PhoneLesson = {
  /** The note is a lesson (said here, or made one on the Mac). */
  isLesson: boolean;
  settings: LessonSettings | null;
  /** Where it sits on the Mac, its clips and the reviews counted there. */
  mac: MacLesson | null;
  /** What this phone said it is, for recordings made here. */
  tag: LessonTagState | null;
  sheet: PhoneSheetDocument | null;
  review: ReviewPlanDocument | null;
};

const LESSON_SQL = `
SELECT session.kind,
  json_extract(session.metadata_json, '$.lesson') AS settings,
  json_extract(session.metadata_json, '$.mac_lesson') AS mac_lesson,
  json_extract(session.metadata_json, '$.lesson_tag') AS tag,
  (SELECT body FROM session_documents
    WHERE id = session.id || ':lesson_sheet' AND deleted_at IS NULL) AS sheet,
  (SELECT body FROM session_documents
    WHERE id = session.id || ':lesson_review' AND deleted_at IS NULL) AS review
FROM sessions AS session
WHERE session.id = ? AND session.deleted_at IS NULL
`;

type LessonRow = {
  kind: string | null;
  settings: string | null;
  mac_lesson: string | null;
  tag: string | null;
  sheet: string | null;
  review: string | null;
};

export function useLesson(sessionId: string): PhoneLesson | null {
  const { data } = useLiveQuery<LessonRow, PhoneLesson | null>({
    sql: LESSON_SQL,
    params: [sessionId],
    mapRows: (rows) => {
      const row = rows[0];
      if (!row) return null;
      const isLesson = row.kind === "lesson";
      return {
        isLesson,
        settings: parseSettings(row.settings),
        mac: parseMacLesson(row.mac_lesson),
        tag: parseTagState(row.tag),
        sheet: isLesson ? parseSheetDocument(row.sheet) : null,
        review: isLesson ? parseReviewPlanDocument(row.review) : null,
      };
    },
  });
  return data ?? null;
}

/** Whether the note is a lesson, without reading its sheet. */
export function useIsLesson(sessionId: string): boolean {
  const { data } = useLiveQuery<{ kind: string | null }, boolean>({
    sql: "SELECT kind FROM sessions WHERE id = ? AND deleted_at IS NULL",
    params: [sessionId],
    mapRows: (rows) => rows[0]?.kind === "lesson",
  });
  return data ?? false;
}
