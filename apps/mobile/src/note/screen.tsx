import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
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

import { useSessionRecorder } from "@/audio/use-session-recorder";
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
import { useKeyboardVisible } from "@/lib/use-keyboard-visible";
import { useMountEffect } from "@/lib/use-mount-effect";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import { BodyEditor } from "./body-editor";
import { NoteFiles } from "./note-files";
import { NoteMeta } from "./note-meta";
import { NoteRecordings } from "./note-recordings";
import { NoteSummary } from "./note-summary";
import { NoteTabs } from "./note-tabs";
import { RecordingDetails } from "./recording-details";
import { RecordingPanel } from "./recording-panel";
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
  const audio = useNoteAudio(id, transcriptState.data === true);
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
  const [listening, setListening] = useState(autoListen);
  const [editorFocused, setEditorFocused] = useState(false);
  const [sheet, setSheet] = useState<"actions" | "folders" | "versions" | null>(
    null,
  );
  const closeSheet = (name: typeof sheet) =>
    setSheet((current) => (current === name ? null : current));
  const keyboardVisible = useKeyboardVisible();
  const recorder = useSessionRecorder(id, listening);
  const hasRecordingHistory =
    Boolean(audio.data) || transcriptState.data === true;
  const active = listening && recorder.phase !== "saved";
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
  });

  const handleBack = async () => {
    await flush();
    await recorder.stop();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const handleStop = async () => {
    await flush();
    const result = await recorder.stop();
    if (result !== "failed") setListening(false);
  };

  const handleRetryRecording = async () => {
    const result = await recorder.retry();
    if (result === "saved") setListening(false);
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
    await recorder.stop();
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
    else if (
      !audio.isLoading &&
      !transcriptState.isLoading &&
      !transcriptState.error &&
      !hasRecordingHistory
    ) {
      setListening(true);
      void recorder.start();
    }
  };

  const handleMoreActions = () => {
    if (!data) return;
    Keyboard.dismiss();
    setEditorFocused(false);
    setSheet("actions");
  };

  // While recording, the note is the recording screen: timer, title, notes.
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
        <NoteRecordings sessionId={id} audio={audio} />
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
        onToggleListening={handleListeningAction}
        onVersionHistory={() => setSheet("versions")}
        visible={sheet === "actions"}
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
