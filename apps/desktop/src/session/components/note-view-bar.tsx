import type { ReactNode } from "react";

import { CalendarBlank, Clock } from "@anlg/ui/components/icons";
import { format, safeParseDate, TZDate } from "@anlg/utils";

import { useLiveQuery } from "~/db";
import { useConfigValue } from "~/shared/config";
import { formatRecordingLength } from "~/shared/format-recording-length";
import { useTimeFormat } from "~/shared/hooks/useTimeFormat";

type SessionMetaRow = { created_at: string | null; audio_ms: number | null };

const SESSION_META_SQL = `
  SELECT
    created_at,
    COALESCE((
      SELECT SUM(CAST(json_extract(capture.value, '$.ended_at_ms') AS INTEGER))
      FROM json_each(CASE
        WHEN json_valid(sessions.metadata_json)
          AND json_type(sessions.metadata_json, '$.speaker_context.meetings') = 'array'
        THEN json_extract(sessions.metadata_json, '$.speaker_context.meetings')
        ELSE '[]'
      END) AS capture
    ), 0) AS audio_ms
  FROM sessions
  WHERE id = ?
`;

export function formatNoteDate(
  timestamp: string | null | undefined,
  timeFormat: string,
  timezone?: string,
): string {
  const parsed = safeParseDate(timestamp);
  if (!parsed) return "";
  const date = timezone ? new TZDate(parsed, timezone) : parsed;
  return `${format(date, "EEE d MMM")} · ${format(date, timeFormat).toUpperCase()}`;
}

/**
 * Named view tabs and the note's date and recording length, between the top
 * bar and the note itself. The tabs sit here, not between the title and the
 * text, because the title is part of each view's own document.
 */
export function NoteViewBar({
  sessionId,
  startedAt,
  switcher,
}: {
  sessionId: string;
  startedAt?: string | null;
  switcher?: ReactNode;
}) {
  const timeFormat = useTimeFormat();
  const timezone = useConfigValue("timezone") || undefined;
  const { data: meta } = useLiveQuery<SessionMetaRow, SessionMetaRow | null>({
    sql: SESSION_META_SQL,
    params: [sessionId],
    mapRows: (rows) => rows[0] ?? null,
  });
  const dateLabel = formatNoteDate(
    startedAt ?? meta?.created_at,
    timeFormat,
    timezone,
  );
  const audioMs = Number(meta?.audio_ms ?? 0);

  return (
    <div data-note-view-bar className="shrink-0 px-3">
      {switcher ? (
        <div className="border-border flex items-end border-b">{switcher}</div>
      ) : null}
      {dateLabel || audioMs >= 1000 ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 pt-5 text-[13px]">
          {dateLabel ? (
            <span className="flex items-center gap-1.5">
              <CalendarBlank size={14} aria-hidden />
              {dateLabel}
            </span>
          ) : null}
          {audioMs >= 1000 ? (
            <span className="flex items-center gap-1.5">
              <Clock size={14} aria-hidden />
              <span className="font-mono text-xs">
                {formatRecordingLength(audioMs)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
