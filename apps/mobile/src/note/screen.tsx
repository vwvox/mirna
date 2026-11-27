import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  hasRecordingInProgress,
  isRecordingInto,
  useRecorder,
} from "@/audio/recorder-provider";
import { FolderPickerSheet } from "@/components/folder-picker-sheet";
import { NoteActionsSheet } from "@/components/note-actions-sheet";
import { NoteConflictBanner } from "@/components/note-conflict-banner";
import { SessionTranscript } from "@/components/session-transcript";
import { StartListeningButton } from "@/components/start-listening-button";
import { IconButton } from "@/components/ui/icon-button";
import { VersionHistorySheet } from "@/components/version-history-sheet";
import { FontFamily, Spacing, Typography } from "@/constants/theme";
import { useNoteAttachments } from "@/data/note-attachment-catalog";
import { pickAndCatalogNoteAttachment } from "@/data/note-attachments";
import { deleteSession, useSessionDetail } from "@/data/session";
import { sessionView, type SessionViewSelection } from "@/data/session-view";
import {
  loadSessionTranscripts,
  useSessionHasTranscript,
} from "@/data/transcripts";
import { captureAnalytics } from "@/lib/analytics";
import { confirmDestructive } from "@/lib/confirm";
import { captureOperationalError } from "@/lib/error-reporting";
import { showToast } from "@/lib/toast";
import { useKeyboardVisible } from "@/lib/use-keyboard-visible";
import { useMountEffect } from "@/lib/use-mount-effect";
import { usePairedMac } from "@/mac-link/pairing";
import { useMacLinkStatus } from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import { BodyEditor } from "./body-editor";
import { MacJobBanner } from "./mac-job-banner";
import { NoteFiles } from "./note-files";
import { NoteMeta } from "./note-meta";
import { NoteRecordings } from "./note-recordings";
import { NoteSummary } from "./note-summary";
import { NoteTabs } from "./note-tabs";
import { RecordingDetails } from "./recording-details";
import { PartRecordingPanel, RecordingPanel } from "./recording-panel";
import { RetranscribeSheet } from "./retranscribe-sheet";
import { TrimSheet } from "./trim-sheet";
import { useNoteAudio } from "./use-note-audio";
import { useNoteDraft } from "./use-note-draft";

export function NoteScreen({
  id,
  autoListen,
}: {
  id: string;
  autoListen: boolean;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const { data, isLoading } = useSessionDetail(id);
  const noteAttachments = useNoteAttachments(id);
  const transcriptState = useSessionHasTranscript(id);
  const recorder = useRecorder();
  const recordingHere = isRecordingInto(recorder, id);
  const audio = useNoteAudio(
    id,
    transcriptState.data === true,
    recordingHere && recorder.addingToRecording,
  );
  const {
    edit: onEdit,
    flush,
    remove,
    snapshot,
    restored,
    bodyDraft,
    onRestored: handleRestored,
  } = useNoteDraft(id, data);
  const [selection, setSelection] = useState<SessionViewSelection | null>(null);
  // Opened to record: the recording screen shows while the recorder starts.
  // Another recording already going keeps this a plain note.
  const [awaitingStart, setAwaitingStart] = useState(
    () => autoListen && !hasRecordingInProgress(recorder),
  );
  const [editorFocused, setEditorFocused] = useState(false);
  const [sheet, setSheet] = useState<
    "actions" | "folders" | "versions" | "retranscribe" | "trim" | null
  >(null);
  const macLink = useMacLinkStatus(id);
  const { mac } = usePairedMac();
  // The Mac has this recording as a note (or tried to): it can do it again.
  const macHasNote =
    Boolean(mac) &&
    Boolean(macLink?.mac_session_id) &&
    (macLink?.state === "done" || macLink?.state === "failed");
  const canTrim =
    Boolean(audio.data?.filename.toLowerCase().endsWith(".wav")) &&
    (audio.availableLocally || macHasNote);
  const closeSheet = (name: typeof sheet) =>
    setSheet((current) => (current === name ? null : current));
  const keyboardVisible = useKeyboardVisible();
  const hasRecordingHistory =
    Boolean(audio.data) || transcriptState.data === true;
  // After 3 hours a recording carries on in a new note. While this note is
  // open it shows that part; once saved, the recording ends on that note.
  const partOfThis =
    recorder.noteId === id &&
    recorder.sessionId !== null &&
    recorder.sessionId !== id &&
    hasRecordingInProgress(recorder);
  const [followingPart, setFollowingPart] = useState(false);
  if (partOfThis && !followingPart) setFollowingPart(true);
  const lastPartId =
    followingPart &&
    recorder.noteId === id &&
    recorder.phase === "saved" &&
    recorder.sessionId !== id
      ? recorder.sessionId
      : null;
  const active =
    recordingHere || partOfThis || awaitingStart || lastPartId !== null;
  // Recorded on this phone as WAV and still here: more can go on its end.
  const canRecordMore =
    !active &&
    !hasRecordingInProgress(recorder) &&
    audio.availableLocally &&
    Boolean(audio.data?.filename.toLowerCase().endsWith(".wav"));
  const leavingRef = useRef(false);
  const { tabs, current, selectedIndex } = sessionView({
    sessionId: id,
    active,
    hasRecordingHistory,
    hasSummary: Boolean(data?.summary),
    hasTranscript: transcriptState.data === true,
    selection,
  });
  const showMemos = current.type === "raw";
  const showEmptyNoteCta =
    !active &&
    !editorFocused &&
    !audio.isLoading &&
    !transcriptState.isLoading &&
    !transcriptState.error &&
    data !== null &&
    data.title.trim() === "" &&
    data.noteText.trim() === "" &&
    !data.summary &&
    !hasRecordingHistory &&
    noteAttachments.length === 0;

  useMountEffect(() => {
    captureAnalytics("note_opened", { entry_point: "mobile_note" });
    if (awaitingStart) {
      void recorder.start(id).finally(() => setAwaitingStart(false));
    }
    // A start that never got the microphone ends with its note.
    return () => recorder.dismiss(id);
  });

  useEffect(() => {
    if (lastPartId && !leavingRef.current) {
      router.replace(`/note/${lastPartId}`);
    }
  }, [lastPartId, router]);

  // Going back keeps the recording going; the notes list shows it.
  const handleBack = async () => {
    leavingRef.current = true;
    await flush();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const handleStop = async () => {
    await flush();
    await recorder.stop("app_button");
  };

  const handleRetryRecording = async () => {
    await recorder.retry();
  };

  const handleRecordMore = async () => {
    if (!canRecordMore) return;
    await flush();
    await recorder.start(id, { more: true });
  };

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      captureOperationalError(error, {
        operation: "recording_permission_settings_open",
      });
    }
  };

  const handleAttachFile = async (
    signal: AbortSignal,
  ): Promise<{ markdown: string } | null> => {
    try {
      const result = await pickAndCatalogNoteAttachment(id, signal);
      if (result.status === "cancelled") return null;
      captureAnalytics("file_uploaded", {
        entry_point: "mobile_note_attachment",
        file_type: "attachment",
      });
      return { markdown: result.markdown };
    } catch (error) {
      if (signal.aborted) return null;
      captureOperationalError(error, {
        operation: "note_attachment_import",
      });
      Alert.alert(
        "Couldn’t attach file",
        error instanceof Error
          ? error.message
          : "The selected file could not be attached.",
      );
      return null;
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirmDestructive(
      `Delete "${data?.title || "Untitled"}"?`,
      "Delete",
    );
    if (!confirmed) return;
    if (recordingHere) await recorder.stop("delete");
    try {
      await remove(() => deleteSession(id));
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (error) {
      captureOperationalError(error, {
        operation: "session_delete",
        tags: { entry_point: "mobile_note" },
      });
    }
  };

  const handleExport = async () => {
    const current = data;
    if (!current) return;
    const draft = snapshot();
    flush();

    const title = (draft.title ?? current.title).trim() || "Untitled";
    const note = (draft.body ?? current.noteText).trim();
    try {
      const transcripts = await loadSessionTranscripts(id);
      const transcript = transcripts
        .map((segment) => `${segment.speaker}: ${segment.text}`)
        .join("\n\n")
        .trim();
      const sections = [`# ${title}`];
      if (current.summary) {
        sections.push(
          `## ${current.summary.title}\n\n${current.summary.text}`.trim(),
        );
      }
      if (note) sections.push(`## Notes\n\n${note}`);
      if (transcript) sections.push(`## Transcript\n\n${transcript}`);

      await Share.share({
        title,
        message: sections.join("\n\n"),
      });
    } catch (error) {
      captureOperationalError(error, {
        operation: "session_export",
        tags: { entry_point: "mobile_note" },
      });
    }
  };

  const handleListeningAction = () => {
    if (active) void handleStop();
    else if (hasRecordingInProgress(recorder)) {
      showToast({
        id: "recording-elsewhere",
        title: "Already recording another note",
        description: "Stop that recording first, from the notes list.",
      });
    } else if (
      !audio.isLoading &&
      !transcriptState.isLoading &&
      !transcriptState.error &&
      !hasRecordingHistory
    ) {
      void recorder.start(id);
    }
  };

  const handleMoreActions = () => {
    if (!data) return;
    Keyboard.dismiss();
    setEditorFocused(false);
    setSheet("actions");
  };

  // While recording, the note is the recording screen: timer, title, notes.
  if ((partOfThis || lastPartId) && recorder.sessionId) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <PartRecordingPanel
          key={recorder.sessionId}
          sessionId={recorder.sessionId}
          recorder={recorder}
          onMount={() => void flush()}
          onBack={() => void handleBack()}
          onStop={() => void handleStop()}
          onRetry={() => void handleRetryRecording()}
          onOpenSettings={() => void handleOpenSettings()}
        />
      </SafeAreaView>
    );
  }

  if (active) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <RecordingPanel
          recorder={recorder}
          note={isLoading ? null : data}
          titleKey={`${id}:${restored?.titleToken ?? 0}`}
          initialTitle={restored?.title ?? data?.title ?? ""}
          body={bodyDraft?.text ?? data?.noteText ?? ""}
          bodyFormat={bodyDraft?.format ?? data?.bodyFormat ?? "markdown"}
          onEdit={onEdit}
          onCommit={() => void flush()}
          onBack={() => void handleBack()}
          onStop={() => void handleStop()}
          onRetry={() => void handleRetryRecording()}
          onOpenSettings={() => void handleOpenSettings()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to notes"
          accessibilityRole="button"
          onPress={() => void handleBack()}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          <Text style={styles.backLabel}>Notes</Text>
        </Pressable>
        <IconButton
          accessibilityLabel="More actions"
          disabled={!data}
          icon="more"
          iconSize={22}
          onPress={handleMoreActions}
        />
      </View>
      <View style={styles.titleBlock}>
        {!isLoading && data ? (
          <TextInput
            key={`${data.id}:${restored?.titleToken ?? 0}`}
            accessibilityLabel="Note title"
            style={styles.title}
            defaultValue={restored?.title ?? data.title}
            multiline
            scrollEnabled={false}
            submitBehavior="blurAndSubmit"
            placeholder="Untitled"
            placeholderTextColor={Colors.muted}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            onBlur={() => {
              setEditorFocused(false);
              void flush();
            }}
            onChangeText={(title) => onEdit({ title })}
            onFocus={() => setEditorFocused(true)}
          />
        ) : (
          <View style={styles.titlePlaceholder} />
        )}
        {!isLoading && data && (
          <NoteMeta sessionId={id} createdAt={data.createdAt} audio={audio} />
        )}
        <MacJobBanner sessionId={id} />
      </View>

      {!isLoading && data && (
        <View key={data.id} style={styles.editor}>
          {tabs.length > 1 && (
            <View style={styles.tabs}>
              <NoteTabs
                labels={tabs.map((tab) =>
                  tab.type === "enhanced"
                    ? "Summary"
                    : tab.type === "raw"
                      ? "Notes"
                      : "Transcript",
                )}
                selectedIndex={selectedIndex}
                onChange={(index) => {
                  void flush();
                  Keyboard.dismiss();
                  setEditorFocused(false);
                  const view = tabs[index];
                  if (view) setSelection({ sessionId: id, active, view });
                }}
              />
            </View>
          )}
          <NoteSummary
            sessionId={id}
            active={active}
            visible={current.type === "enhanced"}
            summary={data.summary}
            hasTranscript={transcriptState.data === true}
            audio={audio}
            onBeforeGenerate={() => flush(true)}
          />
          {current.type === "transcript" && (
            <SessionTranscript
              sessionId={id}
              live={
                active
                  ? {
                      status: recorder.liveStatus,
                      text: recorder.liveTranscript,
                    }
                  : undefined
              }
              recordingDetails={
                !active && (
                  <RecordingDetails
                    sessionId={id}
                    audio={audio}
                    hasTranscript={transcriptState.data}
                  />
                )
              }
            />
          )}
          <View style={[styles.editor, !showMemos && styles.hidden]}>
            <NoteFiles sessionId={id} attachments={noteAttachments} />
            {data.document && !data.plainEditable && (
              <View style={styles.readOnlyChip}>
                <Ionicons
                  name="lock-closed-outline"
                  size={12}
                  color={Colors.muted}
                />
                <Text style={styles.readOnlyLabel}>
                  Formatted note — edit the body on desktop
                </Text>
              </View>
            )}
            <NoteConflictBanner
              sessionId={id}
              onBeforeRestore={flush}
              onRestored={handleRestored}
            />
            {!data.document ? (
              <Text style={styles.readOnlyLabel}>
                Waiting for note content to sync…
              </Text>
            ) : (
              <BodyEditor
                key={`${data.id}:${restored?.bodyToken ?? 0}`}
                accessoryId={`note-editor-controls-${data.id}`}
                bodyFormat={bodyDraft?.format ?? data.bodyFormat}
                value={bodyDraft?.text ?? data.noteText}
                editable={data.plainEditable}
                onAttach={handleAttachFile}
                onChangeText={(body, bodyFormat) =>
                  onEdit({ body, bodyFormat })
                }
                onCommit={flush}
                onFocusChange={setEditorFocused}
              />
            )}
          </View>
        </View>
      )}

      {!active && !keyboardVisible && (
        <NoteRecordings
          sessionId={id}
          audio={audio}
          onRecordMore={
            canRecordMore ? () => void handleRecordMore() : undefined
          }
        />
      )}

      {showEmptyNoteCta && (
        <StartListeningButton onPress={handleListeningAction} />
      )}

      <NoteActionsSheet
        hasRecordingHistory={hasRecordingHistory}
        listening={active}
        onClose={() => closeSheet("actions")}
        onDelete={() => void handleDelete()}
        onExport={() => void handleExport()}
        onSelectFolder={() => setSheet("folders")}
        onImportRecording={audio.importRecording}
        onRecordMore={canRecordMore ? () => void handleRecordMore() : undefined}
        onToggleListening={handleListeningAction}
        onVersionHistory={() => setSheet("versions")}
        onRetranscribe={macHasNote ? () => setSheet("retranscribe") : undefined}
        onTrim={canTrim ? () => setSheet("trim") : undefined}
        visible={sheet === "actions"}
      />

      <RetranscribeSheet
        sessionId={id}
        macName={mac?.mac_name ?? ""}
        hasSummary={Boolean(data?.summary)}
        visible={sheet === "retranscribe"}
        onClose={() => closeSheet("retranscribe")}
      />

      <TrimSheet
        sessionId={id}
        audio={audio}
        macName={mac?.mac_name ?? ""}
        hasSummary={Boolean(data?.summary)}
        visible={sheet === "trim"}
        onClose={() => closeSheet("trim")}
      />

      <FolderPickerSheet
        sessionId={id}
        visible={sheet === "folders"}
        onClose={() => closeSheet("folders")}
      />

      <VersionHistorySheet
        sessionId={id}
        visible={sheet === "versions"}
        onBeforeRestore={flush}
        onClose={() => closeSheet("versions")}
        onRestored={handleRestored}
      />
    </SafeAreaView>
  );
}

const useStyles = createStyleHook((Colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.compact,
    paddingTop: Spacing.sm,
  },
  back: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: Spacing.xs,
    paddingRight: 10,
    borderRadius: 22,
  },
  backPressed: { opacity: 0.6 },
  backLabel: {
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.primary,
  },
  titleBlock: {
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  editor: {
    flex: 1,
  },
  title: {
    padding: 0,
    fontFamily: FontFamily.heading,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Colors.ink,
  },
  titlePlaceholder: { height: 32 },
  tabs: { marginHorizontal: 20, marginTop: Spacing.md, marginBottom: 14 },
  hidden: { display: "none" },
  readOnlyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  readOnlyLabel: {
    ...Typography.caption,
    color: Colors.muted,
  },
}));
