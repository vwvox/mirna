import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  commands as transcriptionCommands,
  type RenderedTranscriptSegment,
} from "@anlg/plugin-transcription";

import { type LessonRoleOf, lessonRoles } from "./roles";

import { liveQueryClient } from "~/db";

const EMPTY: RenderedTranscriptSegment[] = [];

type LessonTranscript = {
  segments: RenderedTranscriptSegment[];
  studentHumanId: string | null;
};

/**
 * The note's transcript as rendered segments, for finding where words were said,
 * with who is the student and who the teacher.
 */
export function useLessonTranscript(sessionId: string | null | undefined): {
  segments: RenderedTranscriptSegment[];
  roleOf: LessonRoleOf;
  ready: boolean;
} {
  const query = useQuery({
    queryKey: ["lesson-segments", sessionId],
    enabled: Boolean(sessionId),
    staleTime: 60_000,
    queryFn: async (): Promise<LessonTranscript> => {
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
  });
  const segments = query.data?.segments ?? EMPTY;
  const studentHumanId = query.data?.studentHumanId ?? null;
  const roleOf = useMemo(
    () => lessonRoles(segments, studentHumanId),
    [segments, studentHumanId],
  );
  return { segments, roleOf, ready: query.isSuccess };
}
