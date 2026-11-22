import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import { memo, type ReactNode } from "react";

import {
  MagnifyingGlass,
  Microphone,
  PencilSimpleLine,
  SidebarSimple,
} from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { MirnaWordmark } from "~/shared/mirna-wordmark";
import { useNewNoteAndListen } from "~/shared/useNewNote";
import {
  SidebarNoteFilterMenu,
  SidebarScopeMenu,
} from "~/sidebar/note-filter-menu";
import { useSidebarUpcomingMeetingStatus } from "~/sidebar/timeline/upcoming-meeting";

export const SidebarTimelineChromeWithUpcomingMeeting = memo(
  function SidebarTimelineChromeWithUpcomingMeeting({
    currentSessionId,
    onNewNote,
    onSearch,
    onToggleSidebar,
    sidebarExpanded,
    showSidebarToggle = true,
    showIgnoredTimelineEvents,
  }: {
    currentSessionId?: string;
    onNewNote: () => void;
    onSearch: () => void;
    onToggleSidebar: () => void;
    sidebarExpanded: boolean;
    showSidebarToggle?: boolean;
    showIgnoredTimelineEvents: boolean;
  }) {
    const upcomingMeetingStatus = useSidebarUpcomingMeetingStatus({
      showIgnored: showIgnoredTimelineEvents,
    });
    const hasUpcomingMeeting = upcomingMeetingStatus
      ? !currentSessionId ||
        upcomingMeetingStatus.itemKey !== `session-${currentSessionId}`
      : false;

    return (
      <SidebarTimelineChrome
        hasUpcomingMeeting={hasUpcomingMeeting}
        onNewNote={onNewNote}
        onSearch={onSearch}
        onToggleSidebar={onToggleSidebar}
        sidebarExpanded={sidebarExpanded}
        showSidebarToggle={showSidebarToggle}
      />
    );
  },
);

function SidebarTimelineChrome({
  hasUpcomingMeeting,
  onToggleSidebar,
  sidebarExpanded,
  showSidebarToggle,
}: {
  hasUpcomingMeeting: boolean;
  onNewNote: () => void;
  onSearch: () => void;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  showSidebarToggle: boolean;
}) {
  const collapsedBadge = !sidebarExpanded
    ? hasUpcomingMeeting
      ? "upcomingMeeting"
      : null
    : null;

  return (
    <div data-tauri-drag-region className="flex w-full items-center gap-3">
      {sidebarExpanded ? (
        <MirnaWordmark
          align="start"
          className="pointer-events-none mt-0.5 text-[21px]"
        />
      ) : null}
      {showSidebarToggle && (
        <div className={cn([sidebarExpanded && "ml-auto"])}>
          <LeftSurfaceChromeButton
            ariaLabel={sidebarExpanded ? "Hide sidebar" : "Show sidebar"}
            badge={collapsedBadge}
            onClick={onToggleSidebar}
          >
            <SidebarSimple size={18} weight="light" />
          </LeftSurfaceChromeButton>
        </div>
      )}
    </div>
  );
}

/** Record, a blank note and search, under the title bar of the expanded sidebar. */
export function SidebarPrimaryActions({
  onNewNote,
  onSearch,
}: {
  onNewNote: () => void;
  onSearch: () => void;
}) {
  const { t } = useLingui();
  const newNoteAndListen = useNewNoteAndListen({ behavior: "current" });
  const searchShortcut = platform() === "macos" ? "⌘K" : "Ctrl K";

  return (
    <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={newNoteAndListen}
          className={cn([
            "bg-mirna-serra text-mirna-mist flex h-[38px] flex-1 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold",
            "hover:bg-mirna-serra/90 transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
          ])}
        >
          <Microphone size={17} />
          <Trans>Record</Trans>
        </button>
        <button
          type="button"
          aria-label={t`New blank note`}
          title={t`New blank note`}
          onClick={onNewNote}
          className={cn([
            "border-border bg-background text-mirna-wordmark flex size-[38px] items-center justify-center rounded-[10px] border",
            "hover:bg-accent transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
          ])}
        >
          <PencilSimpleLine size={17} />
        </button>
      </div>
      <button
        type="button"
        onClick={onSearch}
        className={cn([
          "border-border bg-background text-muted-foreground flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-left text-[13.5px]",
          "hover:border-mirna-sage transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        ])}
      >
        <MagnifyingGlass size={16} />
        <span className="flex-1">
          <Trans>Search notes</Trans>
        </span>
        <kbd className="border-border rounded-[5px] border px-1.5 font-mono text-[11px]">
          {searchShortcut}
        </kbd>
      </button>
      <div className="-mx-1 flex items-center pt-2">
        <SidebarScopeMenu />
        <div className="ml-auto">
          <SidebarNoteFilterMenu />
        </div>
      </div>
    </div>
  );
}

/** Compact actions for the Windows-style title bar, which has no sidebar header. */
export function SidebarNoteActions({
  onNewNote,
  onSearch,
}: {
  onNewNote: () => void;
  onSearch: () => void;
}) {
  return (
    <>
      <LeftSurfaceChromeButton ariaLabel="Search" onClick={onSearch}>
        <MagnifyingGlass size={16} />
      </LeftSurfaceChromeButton>
      <LeftSurfaceChromeButton ariaLabel="New note" onClick={onNewNote}>
        <PencilSimpleLine size={16} />
      </LeftSurfaceChromeButton>
      <SidebarNoteFilterMenu />
    </>
  );
}

export function LeftSurfaceChromeButton({
  ariaLabel,
  badge = null,
  children,
  disabled = false,
  onClick,
}: {
  ariaLabel: string;
  badge?: "upcomingMeeting" | null;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-tauri-drag-region="false"
      disabled={disabled}
      className={cn([
        "pointer-events-auto relative flex size-8 items-center justify-center rounded-lg",
        "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        "disabled:text-muted-foreground/70 disabled:hover:text-muted-foreground/70 disabled:hover:bg-transparent",
      ])}
      onClick={onClick}
    >
      {children}
      {badge ? (
        <span
          aria-hidden="true"
          data-testid="collapsed-sidebar-upcoming-meeting-badge"
          className="ring-background bg-mirna-terra pointer-events-none absolute top-1 right-1 size-1.5 rounded-full ring-2"
        />
      ) : null}
    </button>
  );
}
