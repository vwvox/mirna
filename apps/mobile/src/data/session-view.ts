import {
  computeCurrentNoteTab,
  createEditorTabs,
  type SessionNoteView,
} from "@anlg/utils/session";

export type SessionViewSelection = {
  sessionId: string;
  active: boolean;
  view: SessionNoteView;
};

export function sessionView({
  sessionId,
  active,
  hasRecordingHistory,
  hasSummary,
  hasTranscript,
  hasLesson = false,
  selection,
}: {
  sessionId: string;
  active: boolean;
  hasRecordingHistory: boolean;
  hasSummary: boolean;
  hasTranscript: boolean;
  /** A lesson with its study sheet: the sheet comes first, as on the Mac. */
  hasLesson?: boolean;
  selection: SessionViewSelection | null;
}) {
  const enhancedNoteIds =
    hasSummary || (!active && hasRecordingHistory) ? ["summary"] : [];
  const canShowTranscript = active || hasRecordingHistory || hasTranscript;
  const showLesson = hasLesson && !active;
  const tabs = createEditorTabs({
    enhancedNoteIds,
    canShowTranscript,
    hasLesson: showLesson,
  });
  const current = computeCurrentNoteTab(
    selection?.sessionId === sessionId && selection.active === active
      ? selection.view
      : null,
    active,
    enhancedNoteIds,
    canShowTranscript,
    [],
    showLesson,
  );
  return {
    tabs,
    current,
    selectedIndex: tabs.findIndex(
      (tab) =>
        tab.type === current.type &&
        (tab.type !== "enhanced" ||
          (current.type === "enhanced" && tab.id === current.id)),
    ),
  };
}
