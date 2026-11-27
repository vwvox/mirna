import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useLiveUpdatesPrompt } from "@/audio/live-updates";
import { RECORDING_ALERTS } from "@/audio/long-recording";
import type { Recorder } from "@/audio/recorder-provider";
import {
  describeElapsed,
  formatElapsed,
  type RecorderPhase,
} from "@/audio/recorder-status";
import type { RecorderFailure } from "@/audio/use-session-recorder";
import { LevelStrip } from "@/components/dancing-sticks";
import { ListeningSheet } from "@/components/listening-sheet";
import {
  CornerCurve,
  FontFamily,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useSessionDetail, type SessionDetail } from "@/data/session";
import { useKeyboardVisible } from "@/lib/use-keyboard-visible";
import { useMountEffect } from "@/lib/use-mount-effect";
import type { NoteDraft } from "@/note/note-draft";
import { useNoteDraft } from "@/note/use-note-draft";
import { createStyleHook, useColors } from "@/settings/theme-provider";

function statusText(
  phase: RecorderPhase,
  failure: RecorderFailure | null,
): string {
  switch (phase) {
    case "recording":
      return "Recording";
    case "paused":
      return "Paused";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "unavailable":
      return failure === "notification_permission_denied"
        ? "Notifications needed to record"
        : "Microphone access needed";
    case "interrupted":
      return "Recording interrupted";
    case "save_error":
      return "Recording not saved yet";
    case "error":
      return "Recorder unavailable";
    default:
      return "Getting ready…";
  }
}

/**
 * The note while it records: the timer and level, the title, your notes for
 * the summary, and Pause and Stop. Notes save to the note as you type.
 */
export function RecordingPanel({
  recorder,
  note,
  titleKey,
  initialTitle,
  body,
  bodyFormat,
  onEdit,
  onCommit,
  onBack,
  onStop,
  onRetry,
  onOpenSettings,
}: {
  recorder: Recorder;
  /** Null until the note has loaded. */
  note: SessionDetail | null;
  titleKey: string;
  initialTitle: string;
  body: string;
  bodyFormat: SessionDetail["bodyFormat"];
  onEdit: (patch: NoteDraft) => void;
  onCommit: () => void;
  onBack: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const keyboardVisible = useKeyboardVisible();
  const liveUpdates = useLiveUpdatesPrompt();
  const { phase, failure, durationMs, notice, part } = recorder;
  const recording = phase === "recording";
  const paused = phase === "paused";
  const status = statusText(phase, failure);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to notes"
          accessibilityHint="The recording keeps going"
          hitSlop={4}
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          <Text style={styles.backLabel}>Notes</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View
          accessible
          accessibilityLabel={`${status}, ${describeElapsed(durationMs)}`}
          style={styles.meter}
        >
          <View style={styles.status}>
            {recording ? (
              <View style={styles.dotHalo}>
                <View style={styles.dot} />
              </View>
            ) : paused ? (
              <Ionicons name="pause" size={14} color={Colors.muted} />
            ) : phase === "starting" || phase === "saving" ? (
              <ActivityIndicator size="small" color={Colors.muted} />
            ) : null}
            <Text style={[styles.statusText, recording && styles.statusLive]}>
              {status}
            </Text>
          </View>
          <Text
            maxFontSizeMultiplier={1.3}
            style={[styles.timer, !recording && styles.timerQuiet]}
          >
            {formatElapsed(durationMs)}
          </Text>
          <LevelStrip levels={recorder.levels} paused={!recording} />
        </View>

        {(notice || part > 1 || recorder.addingToRecording) && (
          <View style={styles.notices}>
            {notice && (
              <View accessibilityLiveRegion="polite" style={styles.prompt}>
                <View style={styles.noticeCopy}>
                  <Text style={styles.noticeTitle}>
                    {RECORDING_ALERTS[notice].title}
                  </Text>
                  <Text style={styles.noticeText}>
                    {RECORDING_ALERTS[notice].text}
                  </Text>
                </View>
                {notice !== "paused" && (
                  <View style={styles.promptActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={recorder.keepGoing}
                      style={({ pressed }) => [
                        styles.turnOn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.turnOnText}>Keep going</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
            {part > 1 ? (
              <Text style={styles.partLine}>
                Part {part} · earlier parts are in their own notes
              </Text>
            ) : (
              recorder.addingToRecording && (
                <Text style={styles.partLine}>
                  Adding to this note’s recording
                </Text>
              )
            )}
          </View>
        )}

        {note && (
          <View style={styles.form}>
            <TitleField
              key={titleKey}
              initialTitle={initialTitle}
              onChange={(title) => {
                onEdit({ title });
                recorder.setNotificationTitle(title);
              }}
              onCommit={onCommit}
              onMount={recorder.setNotificationTitle}
            />

            <View style={styles.field}>
              <Text style={styles.label}>
                Your notes · the summary will use them
              </Text>
              {note.document ? (
                <TextInput
                  accessibilityLabel="Your notes. The summary will use them."
                  editable={note.plainEditable}
                  multiline
                  onBlur={onCommit}
                  onChangeText={(text) => onEdit({ body: text, bodyFormat })}
                  placeholder="Anything worth remembering"
                  placeholderTextColor={Colors.muted}
                  style={styles.notes}
                  textAlignVertical="top"
                  value={body}
                />
              ) : (
                <Text style={styles.caption}>
                  Waiting for note content to sync…
                </Text>
              )}
              {note.document && !note.plainEditable && (
                <Text style={styles.caption}>
                  Formatted note — edit the body on desktop
                </Text>
              )}
            </View>

            {liveUpdates.visible ? (
              <View style={styles.prompt}>
                <View style={styles.promptRow}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.chip}
                  >
                    <Ionicons
                      name="mic"
                      size={12}
                      color={Colors.destructiveForeground}
                    />
                    <Text style={styles.chipTime}>
                      {formatElapsed(durationMs)}
                    </Text>
                  </View>
                  <Text style={styles.promptText}>
                    Show the timer at the top of your screen and on the lock
                    screen?
                  </Text>
                </View>
                <View style={styles.promptActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Turn on Live Updates"
                    onPress={liveUpdates.turnOn}
                    style={({ pressed }) => [
                      styles.turnOn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.turnOnText}>Turn on</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Not now"
                    onPress={liveUpdates.notNow}
                    style={({ pressed }) => [
                      styles.notNow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.notNowText}>Not now</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              Platform.OS === "android" && (
                <View style={styles.lockLine}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={Colors.muted}
                  />
                  <Text style={styles.lockText}>
                    Keeps recording with the screen off. The audio stays on this
                    phone until it reaches your Mac.
                  </Text>
                </View>
              )
            )}
          </View>
        )}
      </ScrollView>

      {!keyboardVisible && (
        <ListeningSheet
          phase={phase}
          failure={failure}
          canPause={recorder.canPause}
          onPause={recorder.pause}
          onResume={() => void recorder.resume()}
          onStop={onStop}
          onRetry={onRetry}
          onOpenSettings={onOpenSettings}
        />
      )}
    </View>
  );
}

/**
 * The recording panel for a later part of a long recording: a note of its
 * own, with its own title and notes.
 */
export function PartRecordingPanel({
  sessionId,
  recorder,
  onMount,
  onBack,
  onStop,
  onRetry,
  onOpenSettings,
}: {
  sessionId: string;
  recorder: Recorder;
  /** The part before has just ended; a chance to save its edits. */
  onMount: () => void;
  onBack: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const { data, isLoading } = useSessionDetail(sessionId);
  const draft = useNoteDraft(sessionId, data);
  useMountEffect(() => {
    onMount();
  });

  return (
    <RecordingPanel
      recorder={recorder}
      note={isLoading ? null : data}
      titleKey={`${sessionId}:${draft.restored?.titleToken ?? 0}`}
      initialTitle={draft.restored?.title ?? data?.title ?? ""}
      body={draft.bodyDraft?.text ?? data?.noteText ?? ""}
      bodyFormat={draft.bodyDraft?.format ?? data?.bodyFormat ?? "markdown"}
      onEdit={draft.edit}
      onCommit={() => void draft.flush()}
      onBack={() => void draft.flush().finally(onBack)}
      onStop={() => void draft.flush().finally(onStop)}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />
  );
}

function TitleField({
  initialTitle,
  onChange,
  onCommit,
  onMount,
}: {
  initialTitle: string;
  onChange: (title: string) => void;
  onCommit: () => void;
  onMount: (title: string) => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  // The notification shows the title from the start, and again after a restore.
  useMountEffect(() => {
    onMount(initialTitle);
  });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Title</Text>
      <TextInput
        accessibilityLabel="Title"
        defaultValue={initialTitle}
        onBlur={onCommit}
        onChangeText={onChange}
        onSubmitEditing={() => Keyboard.dismiss()}
        placeholder="Untitled"
        placeholderTextColor={Colors.muted}
        returnKeyType="done"
        style={styles.title}
      />
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  back: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.sm,
    borderRadius: Radius.pill,
  },
  backLabel: {
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.primary,
  },
  pressed: { opacity: 0.6 },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing.lg },
  meter: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  status: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  dotHalo: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: Colors.alert,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.accent,
  },
  statusText: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: Colors.muted,
  },
  statusLive: { color: Colors.accent },
  timer: {
    fontFamily: FontFamily.mono,
    fontSize: 64,
    lineHeight: 72,
    fontWeight: "500",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
    color: Colors.ink,
  },
  timerQuiet: { color: Colors.muted },
  form: {
    gap: Spacing.md,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  field: { gap: 6 },
  label: {
    fontFamily: FontFamily.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: Colors.muted,
  },
  title: {
    minHeight: 44,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    fontFamily: FontFamily.heading,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "600",
    color: Colors.ink,
  },
  notes: {
    height: 168,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
    ...Typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
  },
  caption: {
    ...Typography.caption,
    color: Colors.muted,
  },
  lockLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  lockText: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
  notices: {
    gap: Spacing.sm,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  noticeCopy: { gap: 2 },
  noticeTitle: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primary,
  },
  noticeText: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.primary,
  },
  partLine: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
  prompt: {
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: 16,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
  },
  promptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  chip: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 7,
    paddingRight: 9,
    borderRadius: 12,
    backgroundColor: Colors.accent,
  },
  chipTime: {
    fontFamily: FontFamily.mono,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    color: Colors.destructiveForeground,
  },
  promptText: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.primary,
  },
  promptActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  turnOn: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: Colors.primary,
  },
  turnOnText: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
  notNow: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  notNowText: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: Colors.primary,
  },
}));
