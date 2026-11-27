import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  commands as transcriptionCommands,
  type RenderedTranscriptSegment,
} from "@anlg/plugin-transcription";

import { type LessonRoleOf, lessonRoles } from "./roles";

import { liveQueryClient } from "~/db";

const EMPTY: RenderedTranscriptSegment[] = [];

type LessonTranscriptData = {
  segments: RenderedTranscriptSegment[];
  studentHumanId: string | null;
};

export type LessonTranscript = {
  segments: RenderedTranscriptSegment[];
  roleOf: LessonRoleOf;
  ready: boolean;
};

function lessonTranscriptQuery(sessionId: string | null | undefined) {
  return {
    queryKey: ["lesson-segments", sessionId],
    enabled: Boolean(sessionId),
    staleTime: 60_000,
    queryFn: async (): Promise<LessonTranscriptData> => {
      const [result, owners] = await Promise.all([
        transcriptionCommands.renderSessionTranscript({
          session_id: sessionId!,
          self_human_id: null,
        }),
        liveQueryClient.execute<{ owner_user_id: string }>(
          "SELECT owner_user_id FROM sessions WHERE id = ?",
          [sessionId!],
        ),
      ]);
      if (result.status === "error") throw new Error(result.error);
      return {
        segments: result.data?.segments ?? EMPTY,
        studentHumanId: owners[0]?.owner_user_id || null,
      };
    },
  };
}

/** The same as `useLessonTranscript`, outside React. */
export async function loadLessonTranscript(
  sessionId: string,
): Promise<{ segments: RenderedTranscriptSegment[]; roleOf: LessonRoleOf }> {
  const data = await lessonTranscriptQuery(sessionId).queryFn();
  return {
    segments: data.segments,
    roleOf: lessonRoles(data.segments, data.studentHumanId),
  };
}

/**
 * The note's transcript as rendered segments, for finding where words were said,
 * with who is the student and who the teacher.
 */
export function useLessonTranscript(
  sessionId: string | null | undefined,
): LessonTranscript {
  const query = useQuery(lessonTranscriptQuery(sessionId));
  const segments = query.data?.segments ?? EMPTY;
  const studentHumanId = query.data?.studentHumanId ?? null;
  const roleOf = useMemo(
    () => lessonRoles(segments, studentHumanId),
    [segments, studentHumanId],
  );
  return { segments, roleOf, ready: query.isSuccess };
}

/** The transcripts of several lessons, by lesson id, once each has loaded. */
export function useLessonTranscripts(
  sessionIds: string[],
): ReadonlyMap<string, LessonTranscript> {
  const results = useQueries({
    queries: sessionIds.map((sessionId) => lessonTranscriptQuery(sessionId)),
  });
  const key = results
    .map((result, index) => `${sessionIds[index]}:${result.dataUpdatedAt}`)
    .join(",");
  return useMemo(() => {
    const transcripts = new Map<string, LessonTranscript>();
    results.forEach((result, index) => {
      if (!result.data) return;
      transcripts.set(sessionIds[index]!, {
        segments: result.data.segments,
        roleOf: lessonRoles(result.data.segments, result.data.studentHumanId),
        ready: true,
      });
    });
    return transcripts;
    // The results array is new on every render; its data changes with `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
