import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CornerCurve, Radius, Spacing, Typography } from "@/constants/theme";
import { id as newId } from "@/lib/ids";
import { useMountEffect } from "@/lib/use-mount-effect";
import { queuePhoneReview } from "@/mac-link/lessons";
import { usePairedMac } from "@/mac-link/pairing";
import { useReviewOutbox } from "@/mac-link/schedule";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { formatClock } from "@/note/mac-progress";

import { type ClipPlayer, useClipPlayer } from "./clip-player";
import { Focus, PieceView } from "./review-pieces";
import {
  checkedOutcome,
  FRESH_STATE,
  intoPractice,
  KIND_LABELS,
  type PieceState,
  piecesFor,
  type ReviewLength,
  type ReviewOutcome,
  type ReviewPiece,
  type ReviewPlanDocument,
  type ReviewResult,
  type ReviewRun,
  runScore,
} from "./review-plan";
import { useLesson } from "./use-lesson";

/**
 * The Mac's review of a lesson, played full screen on the phone: the same
 * pieces in the same order, in one column, with Next at the thumb. It works
 * offline; the run is saved here and goes to the Mac at the next sync.
 */
export function ReviewScreen({
  sessionId,
  length,
  extra,
}: {
  sessionId: string;
  length: ReviewLength;
  /** "5 more minutes": the pieces the 5-minute review leaves out. */
  extra: boolean;
}) {
  const router = useRouter();
  const lesson = useLesson(sessionId);
  const insets = useSafeAreaInsets();
  if (!lesson?.review || !lesson.mac) {
    return (
      <View style={[styles.root, styles.empty, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.emptyText}>
          {lesson === null
            ? "Opening the review…"
            : "This lesson has no review on the phone yet. It comes from your Mac with the next sync."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.next, pressed && styles.pressed]}
        >
          <Text style={styles.nextLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <ReviewPlayer
      sessionId={sessionId}
      macSessionId={lesson.mac.mac_session_id}
      document={lesson.review}
      countedIds={lesson.mac.reviews.map((review) => review.id)}
      length={length}
      extra={extra}
    />
  );
}

function ReviewPlayer({
  sessionId,
  macSessionId,
  document,
  countedIds,
  length,
  extra,
}: {
  sessionId: string;
  macSessionId: string;
  document: ReviewPlanDocument;
  countedIds: string[];
  length: ReviewLength;
  extra: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const player = useClipPlayer(sessionId);
  const plan = document.plan;
  const pieces = useMemo(
    () =>
      extra
        ? plan.pieces.filter((entry) => !entry.core)
        : piecesFor(plan, length),
    [extra, length, plan],
  );
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, PieceState>>({});
  const [results, setResults] = useState<Record<string, ReviewResult>>({});
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(new Date());
  const runId = useRef(newId());
  const endedAt = useRef<number | null>(null);
  const saved = useRef(false);
  const wrapUp = index >= pieces.length;
  const piece = wrapUp ? null : pieces[index]!;
  const state = (piece && states[piece.id]) || FRESH_STATE;
  const ordered = pieces
    .map((entry) => results[entry.id])
    .filter((result): result is ReviewResult => Boolean(result));
  const latest = useRef(ordered);
  latest.current = ordered;

  const save = (done: ReviewResult[]) => {
    if (saved.current || done.length === 0) return;
    saved.current = true;
    const run: ReviewRun = {
      id: runId.current,
      startedAt: startedAt.current.toISOString(),
      endedAt: new Date(endedAt.current ?? Date.now()).toISOString(),
      length: extra ? 5 : length,
      device: "phone",
      planHash: document.sourceHash,
      results: done,
    };
    // Saved here first; the sync after it is only a try.
    void queuePhoneReview({ sessionId, macSessionId, run })
      .then(() => sendRecordingsToMac("open"))
      .catch((error: unknown) => {
        console.warn("[lesson] review not saved", error);
      });
  };

  useMountEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    openPiece(pieces[0], player);
    return () => {
      clearInterval(timer);
      player.stop();
      // Left part-way (or with Back): what was answered still counts.
      if (latest.current.length >= 2) save(latest.current);
    };
  });

  // The wrap-up saves the whole run, with the last answer in it.
  useEffect(() => {
    if (wrapUp) save(ordered);
  });

  const go = (next: number) => {
    player.stop();
    const target = Math.max(0, Math.min(pieces.length, next));
    if (target >= pieces.length && endedAt.current === null) {
      endedAt.current = Date.now();
    }
    setIndex(target);
    openPiece(pieces[target], player);
  };

  const record = (
    outcome: ReviewOutcome,
    cards?: { cardId: string; knew: boolean }[],
  ) => {
    if (!piece) return;
    setResults((current) => ({
      ...current,
      [piece.id]: {
        pieceId: piece.id,
        kind: piece.kind,
        outcome,
        cardId: piece.cardId,
        markId: piece.markId,
        ...(cards ? { cards } : {}),
      },
    }));
  };

  const update = (next: Partial<PieceState>) => {
    if (!piece) return;
    const merged = { ...state, ...next };
    setStates((current) => ({ ...current, [piece.id]: merged }));
    const outcome = checkedOutcome(piece.body, merged);
    if (outcome && !results[piece.id]) record(outcome);
  };

  const grade = (
    outcome: ReviewOutcome,
    cards?: { cardId: string; knew: boolean }[],
  ) => {
    record(outcome, cards);
    go(index + 1);
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/note/${sessionId}`);
  };

  const left =
    length * 60 -
    ((endedAt.current ?? now) - startedAt.current.getTime()) / 1000;
  const answered = piece ? Boolean(results[piece.id]) : false;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the review"
          hitSlop={8}
          onPress={close}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={24} color={Focus.text} />
        </Pressable>
        <Text style={styles.where} numberOfLines={1}>
          {piece
            ? `${index + 1} of ${pieces.length} · ${KIND_LABELS[piece.kind]}`
            : `${pieces.length} of ${pieces.length} · Wrap-up`}
        </Text>
        <Text
          accessibilityLabel={`${Math.max(0, Math.round(left / 60))} minutes left`}
          style={[styles.clock, left < 0 && styles.over]}
        >
          {left >= 0 ? formatClock(left) : `+${formatClock(-left)}`}
        </Text>
      </View>
      <View style={styles.track}>
        {pieces.map((entry, position) => {
          const result = results[entry.id];
          return (
            <View
              key={entry.id}
              style={[
                styles.segment,
                result
                  ? result.outcome === "knew"
                    ? styles.segmentGood
                    : result.outcome === "shaky"
                      ? styles.segmentShaky
                      : styles.segmentBad
                  : position === index && styles.segmentNow,
              ]}
            />
          );
        })}
      </View>

      {piece ? (
        <>
          <ScrollView
            key={piece.id}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text accessibilityRole="header" style={styles.prompt}>
              {piece.prompt}
            </Text>
            <PieceView
              piece={piece}
              state={state}
              update={update}
              onGrade={grade}
              player={player}
            />
          </ScrollView>
          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
            ]}
          >
            {index > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back one piece"
                onPress={() => go(index - 1)}
                style={({ pressed }) => [
                  styles.back,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="chevron-back" size={22} color={Focus.text} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => go(index + 1)}
              style={({ pressed }) => [
                styles.next,
                !answered && styles.skip,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.nextLabel, !answered && styles.skipLabel]}>
                {answered ? "Next" : "Skip"}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <WrapUp
          sessionId={sessionId}
          pieces={pieces}
          results={ordered}
          runId={runId.current}
          countedIds={countedIds}
          seconds={
            ((endedAt.current ?? now) - startedAt.current.getTime()) / 1000
          }
          moreLeft={
            !extra && length === 5 && plan.pieces.some((entry) => !entry.core)
          }
          bottomInset={insets.bottom}
          onBack={close}
          onMore={() => router.replace(`/review/${sessionId}?length=5&extra=1`)}
        />
      )}
    </View>
  );
}

/** A listening piece starts with the teacher's voice, as a class would. */
function openPiece(piece: ReviewPiece | undefined, player: ClipPlayer) {
  if (piece?.body.type === "choice" && piece.body.listen) {
    player.play(piece.body.listen);
  }
}

function outcomeLabel(piece: ReviewPiece, result: ReviewResult | undefined) {
  if (!result) return "Skipped";
  if (result.cards?.length) {
    return `${result.cards.filter((card) => card.knew).length} of ${result.cards.length}`;
  }
  return result.outcome === "knew"
    ? "Right"
    : result.outcome === "shaky"
      ? "Shaky"
      : piece.body.type === "reveal"
        ? "Missed"
        : "Not quite";
}

function WrapUp({
  sessionId,
  pieces,
  results,
  runId,
  countedIds,
  seconds,
  moreLeft,
  bottomInset,
  onBack,
  onMore,
}: {
  sessionId: string;
  pieces: ReviewPiece[];
  results: ReviewResult[];
  runId: string;
  countedIds: string[];
  seconds: number;
  moreLeft: boolean;
  bottomInset: number;
  onBack: () => void;
  onMore: () => void;
}) {
  const outbox = useReviewOutbox();
  const { mac } = usePairedMac();
  const macName = mac?.mac_name || "your Mac";
  const sync = useMutation({ mutationFn: () => sendRecordingsToMac("user") });
  const byPiece = new Map(results.map((result) => [result.pieceId, result]));
  const score = runScore(results);
  const back = intoPractice(pieces, results);
  const queued = outbox.find(
    (entry) => entry.session_id === sessionId && entry.run.id === runId,
  );
  const counted = countedIds.includes(runId);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(bottomInset, Spacing.lg) },
      ]}
    >
      <Text accessibilityRole="header" style={styles.done}>
        {results.length === 0
          ? "Nothing answered this time."
          : `Done in ${minutes > 0 ? `${minutes} min ` : ""}${rest} s. ${score.right} of ${score.total} right.`}
      </Text>
      <View style={styles.list}>
        <View style={styles.listRows}>
          {pieces.map((piece) => {
            const result = byPiece.get(piece.id);
            return (
              <View key={piece.id} style={styles.listRow}>
                <Text style={styles.listKind} numberOfLines={1}>
                  {KIND_LABELS[piece.kind]}
                </Text>
                <Text
                  style={[
                    styles.listOutcome,
                    result?.outcome === "knew" && styles.goodText,
                    result && result.outcome !== "knew" && styles.shakyText,
                  ]}
                >
                  {outcomeLabel(piece, result)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {results.length > 0 && (
        <View style={styles.saved}>
          <Text style={styles.savedTitle}>
            {counted
              ? `Counted on ${macName}`
              : queued?.sent_at
                ? `Sent to ${macName}`
                : "Saved on this phone · waiting for the Mac"}
          </Text>
          <Text style={styles.savedText}>
            {counted
              ? "Your Practise cards there have moved."
              : queued?.sent_at
                ? "Mirna there moves your Practise cards when it counts it."
                : `It goes to ${macName} the next time you’re on the same Wi-Fi, or when you tap Sync now. The Mac then moves your Practise cards.`}
          </Text>
          {!counted && !queued?.sent_at && (
            <Pressable
              accessibilityRole="button"
              disabled={sync.isPending}
              onPress={() => sync.mutate()}
              style={({ pressed }) => [
                styles.syncButton,
                (pressed || sync.isPending) && styles.pressed,
              ]}
            >
              <Text style={styles.syncLabel}>
                {sync.isPending ? "Syncing…" : "Sync now"}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {back.length > 0 && (
        <Text style={styles.savedText}>
          Back in Practise: {back.slice(0, 6).join(", ")}
          {back.length > 6 ? ` and ${back.length - 6} more` : ""}
        </Text>
      )}

      <View style={styles.wrapButtons}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.next, pressed && styles.pressed]}
        >
          <Text style={styles.nextLabel}>Back to the sheet</Text>
        </Pressable>
        {moreLeft && (
          <Pressable
            accessibilityRole="button"
            onPress={onMore}
            style={({ pressed }) => [
              styles.next,
              styles.skip,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.nextLabel, styles.skipLabel]}>
              5 more minutes
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Focus.background },
  empty: {
    justifyContent: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  emptyText: { ...Typography.body, color: Focus.text },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.compact,
    paddingVertical: Spacing.xs,
    backgroundColor: Focus.bar,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  where: { ...Typography.bodyStrong, color: Focus.text, flex: 1 },
  clock: {
    ...Typography.time,
    color: Focus.muted,
    minWidth: 48,
    textAlign: "right",
  },
  over: { color: Focus.bad },
  track: {
    flexDirection: "row",
    gap: 3,
    paddingHorizontal: Spacing.compact,
    paddingBottom: Spacing.xs,
    backgroundColor: Focus.bar,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Focus.border,
  },
  segmentNow: { backgroundColor: Focus.accent },
  segmentGood: { backgroundColor: Focus.good },
  segmentShaky: { backgroundColor: Focus.accent, opacity: 0.6 },
  segmentBad: { backgroundColor: Focus.bad },
  scroll: { flex: 1 },
  content: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  prompt: { ...Typography.title, color: Focus.text },
  footer: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Focus.border,
    backgroundColor: Focus.bar,
  },
  back: {
    width: 56,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
  },
  next: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.accent,
  },
  nextLabel: { ...Typography.bodyStrong, fontSize: 17, color: Focus.onAccent },
  skip: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Focus.line,
  },
  skipLabel: { color: Focus.text },
  pressed: { opacity: 0.6 },
  done: { ...Typography.title, color: Focus.text },
  list: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Focus.border,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.card,
  },
  // The last row's line hides under the card's edge.
  listRows: { marginBottom: -StyleSheet.hairlineWidth },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Focus.border,
  },
  listKind: { ...Typography.body, color: Focus.text, flex: 1 },
  listOutcome: { ...Typography.bodyStrong, color: Focus.muted },
  goodText: { color: Focus.good },
  shakyText: { color: Focus.bad },
  saved: {
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.answer,
  },
  savedTitle: { ...Typography.bodyStrong, color: Focus.text },
  savedText: { ...Typography.caption, color: Focus.muted },
  syncButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: Radius.control,
  },
  syncLabel: { ...Typography.captionStrong, color: Focus.text },
  wrapButtons: { gap: Spacing.sm, marginTop: Spacing.sm },
});
