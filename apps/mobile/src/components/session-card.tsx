import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { hasSummaryContent, resolveSummaryDocument } from "@anlg/utils/session";

import {
  CornerCurve,
  FontFamily,
  MirnaColors,
  Radius,
  Spacing,
} from "@/constants/theme";
import { relativeLabel, type TimelineSession } from "@/data/timeline";
import { useLiveQuery } from "@/db";
import { showToast } from "@/lib/toast";
import { retryRecordingOnMac } from "@/mac-link/sender";
import type { MacLinkStatus } from "@/mac-link/status";
import {
  formatLength,
  noteLengthMs,
  recentMacUpdate,
  retryProblem,
  sendPercent,
  summarySnippet,
} from "@/note/mac-progress";
import { createStyleHook, useColors } from "@/settings/theme-provider";

const DELETE_ACTIONS: MenuAction[] = [
  {
    id: "delete",
    title: "Delete",
    image: "trash",
    attributes: { destructive: true },
  },
];

const SWIPE_ACTION_WIDTH = 88;

/** What a card shows beyond the timeline row: length, summary, recording. */
export type SessionCardDetails = {
  hasRecording: boolean;
  transcribed: boolean;
  audioFilename: string | null;
  audioSizeBytes: number | null;
  transcriptMs: number | null;
  summarySnippet: string | null;
};

type CardDetailsRow = {
  session_id: string;
  title: string;
  audio_filename: string | null;
  audio_size_bytes: number | null;
  transcript_status: string | null;
  transcript_ms: number | null;
  summary_documents_json: string;
};

const CARD_DETAILS_SQL = `
SELECT
  sessions.id AS session_id,
  sessions.title,
  audio.filename AS audio_filename,
  audio.size_bytes AS audio_size_bytes,
  json_extract(audio.metadata_json, '$.transcript_status') AS transcript_status,
  (
    SELECT SUM(transcript.ended_at_ms - transcript.started_at_ms)
    FROM transcripts AS transcript
    WHERE transcript.session_id = sessions.id
      AND transcript.deleted_at IS NULL
      AND transcript.ended_at_ms > transcript.started_at_ms
  ) AS transcript_ms,
  COALESCE((
    SELECT json_group_array(json_object(
      'id', document.id, 'title', document.title,
      'body', document.body, 'body_format', document.body_format,
      'kind', document.kind, 'template_id', document.template_id,
      'sort_order', document.sort_order
    )) FROM session_documents AS document
    WHERE document.session_id = sessions.id
      AND document.kind IN ('summary', 'template_output') AND document.deleted_at IS NULL
  ), '[]') AS summary_documents_json
FROM json_each(?) AS ids
JOIN sessions ON sessions.id = ids.value AND sessions.deleted_at IS NULL
LEFT JOIN session_attachments AS audio
  ON audio.session_id = sessions.id
  AND audio.source_type = 'session_audio'
  AND audio.deleted_at IS NULL
`;

type SummaryDocument = {
  id: string;
  title: string;
  body: string;
  body_format: string;
  kind: string;
  template_id: string;
  sort_order: number;
};

function mapCardDetails(rows: CardDetailsRow[]) {
  const details = new Map<string, SessionCardDetails>();
  for (const row of rows) {
    let documents: SummaryDocument[] = [];
    try {
      documents = JSON.parse(row.summary_documents_json) as SummaryDocument[];
    } catch {
      documents = [];
    }
    const summary = resolveSummaryDocument(documents, row.title);
    details.set(row.session_id, {
      hasRecording: row.audio_filename !== null,
      transcribed: row.transcript_status === "complete",
      audioFilename: row.audio_filename,
      audioSizeBytes: row.audio_size_bytes,
      transcriptMs: row.transcript_ms,
      summarySnippet:
        summary && hasSummaryContent(summary.body, row.title)
          ? summarySnippet(summary.body, summary.body_format)
          : null,
    });
  }
  return details;
}

/** Lengths and summary snippets for the notes on screen, in one query. */
export function useSessionCardDetails(sessionIds: string[]) {
  const { data } = useLiveQuery<
    CardDetailsRow,
    Map<string, SessionCardDetails>
  >({
    sql: CARD_DETAILS_SQL,
    params: [JSON.stringify(sessionIds)],
    mapRows: mapCardDetails,
  });
  return data ?? new Map<string, SessionCardDetails>();
}

function clockTime(value: string | Date) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
}

type CardStatus = { text: string; tone: "mac" | "muted" | "problem" };

function cardStatus(
  macStatus: MacLinkStatus | undefined,
  mac: string,
  macAway: boolean,
  needsPairing: boolean,
): CardStatus | null {
  if (needsPairing) {
    return { text: "Saved on this phone · pair to get notes", tone: "muted" };
  }
  switch (macStatus?.state) {
    case "waiting":
      return {
        text: macAway ? "Waiting for Wi-Fi" : "Waiting to send",
        tone: "muted",
      };
    case "sending":
      return { text: `Sending to ${mac}`, tone: "mac" };
    case "on_mac":
      return { text: `Waiting its turn on ${mac}`, tone: "mac" };
    case "transcribing":
      return { text: `Transcribing on ${mac}`, tone: "mac" };
    case "summarizing":
      return { text: `Summarizing on ${mac}`, tone: "mac" };
    case "failed":
      return { text: "Couldn’t transcribe", tone: "problem" };
    default:
      return null;
  }
}

export function SessionCard({
  macStatus,
  macName,
  macAway = false,
  needsPairing = false,
  details,
  session,
  showFolder,
  showTags,
  onPress,
  onDelete,
  variant = "card",
}: {
  /** Where the recording is on its way to the Mac; absent when not paired. */
  macStatus?: MacLinkStatus;
  macName?: string;
  /** Not on Wi-Fi, so recordings wait on the phone. */
  macAway?: boolean;
  /** A recording no Mac has seen, on a phone that isn't paired. */
  needsPairing?: boolean;
  details?: SessionCardDetails;
  session: TimelineSession;
  showFolder: boolean;
  showTags: boolean;
  onPress: () => void;
  onDelete?: () => void;
  variant?: "card" | "plain";
}) {
  const styles = useStyles();
  const Colors = useColors();
  const [width, setWidth] = useState<number>();
  const swipeableRef = useRef<SwipeableMethods>(null);
  const mac = macName || "your Mac";
  const retry = useMutation({
    mutationFn: () => retryRecordingOnMac(session.id),
    onSuccess: (outcome) => {
      const problem = retryProblem(outcome, mac);
      if (problem) showToast({ id: `mac-retry-${session.id}`, ...problem });
    },
    onError: () =>
      showToast({
        id: `mac-retry-${session.id}`,
        title: "Couldn’t try again",
        description: `${mac} didn’t take it back. Open the note to try again.`,
      }),
  });
  const title = session.title || "Untitled";
  const folder = showFolder ? session.folderPath : "";
  const tags = showTags ? session.tags.map((tag) => `#${tag}`).join(" ") : "";
  const lengthMs = details
    ? noteLengthMs({
        filename: details.audioFilename,
        sizeBytes: details.audioSizeBytes,
        macRecordings: macStatus?.mac_recordings,
        fallbackMs: details.transcriptMs,
      })
    : null;
  const when = [
    clockTime(session.startedAt),
    lengthMs ? formatLength(lengthMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const status = cardStatus(macStatus, mac, macAway, needsPairing);
  const percent =
    macStatus?.state === "sending" ? sendPercent(macStatus) : null;
  const snippet =
    !status && (!macStatus || macStatus.state === "done")
      ? (details?.summarySnippet ?? null)
      : null;
  const updatedOnMac =
    macStatus?.state === "done" ? recentMacUpdate(macStatus) : null;
  const updatedLabel = updatedOnMac
    ? `Updated on ${mac} · ${clockTime(updatedOnMac)}`
    : null;
  const canRetry = macStatus?.state === "failed";
  const accessibilityLabel = [
    title,
    folder ? `Folder ${folder}` : "",
    when || relativeLabel(session.startedAt),
    status
      ? percent !== null
        ? `${status.text}, ${percent}%`
        : status.text
      : "",
    snippet ?? "",
    updatedLabel ?? "",
    tags,
  ]
    .filter(Boolean)
    .join(", ");

  const content = (
    <Pressable
      accessibilityHint={
        onDelete ? "Long press or swipe left for actions" : undefined
      }
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityActions={
        canRetry ? [{ name: "retry", label: "Try again" }] : undefined
      }
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "retry" && !retry.isPending) {
          retry.mutate();
        }
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        variant === "plain" && styles.cardPlain,
        { width },
        pressed && styles.cardPressed,
      ]}
    >
      {folder && (
        <View style={styles.folderRow}>
          <Ionicons name="folder-outline" size={12} color={Colors.muted} />
          <Text style={styles.folder} numberOfLines={1}>
            {folder}
          </Text>
        </View>
      )}
      <View style={styles.titleRow}>
        <Text
          style={[styles.title, !session.title && styles.titleEmpty]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {when ? <Text style={styles.when}>{when}</Text> : null}
      </View>

      {status && percent !== null && (
        <View style={styles.sending}>
          <View style={styles.statusRow}>
            <Ionicons name="arrow-up" size={15} color={Colors.primary} />
            <Text
              style={[styles.statusText, styles.statusMac]}
              numberOfLines={1}
            >
              {status.text}
            </Text>
            <Text style={styles.percent}>{percent}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
        </View>
      )}
      {status && percent === null && status.tone === "mac" && (
        <View style={styles.statusRow}>
          <View style={styles.sageRing}>
            <View style={styles.sageDot} />
          </View>
          <Text style={[styles.statusText, styles.statusMac]} numberOfLines={1}>
            {status.text}
          </Text>
        </View>
      )}
      {status?.tone === "muted" && (
        <View style={styles.statusRow}>
          <Ionicons
            name={needsPairing ? "phone-portrait-outline" : "time-outline"}
            size={15}
            color={Colors.muted}
          />
          <Text style={styles.statusText} numberOfLines={1}>
            {status.text}
          </Text>
        </View>
      )}
      {status?.tone === "problem" && (
        <View style={styles.statusRow}>
          <Ionicons
            name="alert-circle-outline"
            size={15}
            color={Colors.destructive}
          />
          <Text style={[styles.statusText, styles.statusProblem]}>
            {status.text} ·
          </Text>
          <Pressable
            accessibilityLabel={`Try again to transcribe ${title}`}
            accessibilityRole="button"
            disabled={retry.isPending}
            hitSlop={{ top: 13, bottom: 13, left: 6, right: 16 }}
            onPress={() => retry.mutate()}
            style={({ pressed }) => pressed && styles.retryPressed}
          >
            <Text style={[styles.statusText, styles.retry]}>
              {retry.isPending ? "Trying again…" : "Try again"}
            </Text>
          </Pressable>
        </View>
      )}

      {snippet ? (
        <Text style={styles.snippet} numberOfLines={2}>
          {snippet}
        </Text>
      ) : null}
      {updatedLabel && (
        <View style={styles.updatedTag}>
          <Ionicons name="refresh" size={13} color={Colors.primary} />
          <Text style={styles.updatedText}>{updatedLabel}</Text>
        </View>
      )}
      {tags && (
        <Text style={styles.tags} numberOfLines={1}>
          {tags}
        </Text>
      )}
    </Pressable>
  );

  const row = (
    <View
      onLayout={({ nativeEvent }) => {
        const nextWidth = nativeEvent.layout.width;
        // Native MenuView measures its trigger on mount, so wait for this width.
        setWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={styles.row}
    >
      {onDelete && width != null ? (
        <MenuView
          key={width}
          actions={DELETE_ACTIONS}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "delete") onDelete();
          }}
          shouldOpenOnLongPress
        >
          {content}
        </MenuView>
      ) : (
        content
      )}
    </View>
  );

  if (!onDelete) return row;

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={2}
      overshootRight={false}
      rightThreshold={SWIPE_ACTION_WIDTH / 2}
      renderRightActions={() => (
        <Pressable
          accessibilityLabel={`Delete ${title}`}
          accessibilityRole="button"
          onPress={() => {
            swipeableRef.current?.close();
            onDelete();
          }}
          style={({ pressed }) => [
            styles.swipeAction,
            pressed && styles.swipeActionPressed,
          ]}
        >
          <Ionicons
            name="trash-outline"
            size={20}
            color={Colors.destructiveForeground}
          />
          <Text style={styles.swipeActionLabel}>Delete</Text>
        </Pressable>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

const CARD_RADIUS = 16;

const useStyles = createStyleHook((Colors) => ({
  row: {
    alignSelf: "stretch",
    marginBottom: 10,
  },
  card: {
    minHeight: 64,
    gap: Spacing.sm,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: CARD_RADIUS,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  cardPressed: {
    backgroundColor: Colors.accentSurface,
  },
  cardPlain: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  folder: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: Spacing.compact,
  },
  title: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    color: Colors.ink,
  },
  titleEmpty: {
    color: Colors.muted,
  },
  when: {
    fontFamily: FontFamily.mono,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
  sending: { gap: 6 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusText: {
    flexShrink: 1,
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.muted,
  },
  statusMac: { flex: 1, color: Colors.primary },
  statusProblem: { flexShrink: 0, color: Colors.destructive },
  retry: {
    color: Colors.destructive,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  retryPressed: { opacity: 0.6 },
  percent: {
    fontFamily: FontFamily.mono,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: Colors.primary,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accentSurface,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  sageRing: {
    width: 14,
    height: 14,
    marginRight: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: Colors.accentSurface,
  },
  sageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: MirnaColors.sage,
  },
  snippet: {
    marginTop: -2,
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
  },
  updatedTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 3,
    paddingLeft: Spacing.sm,
    paddingRight: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSurface,
  },
  updatedText: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: Colors.primary,
  },
  tags: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    marginLeft: Spacing.sm,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    borderRadius: CARD_RADIUS,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.destructive,
  },
  swipeActionPressed: {
    opacity: 0.8,
  },
  swipeActionLabel: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.destructiveForeground,
  },
}));
