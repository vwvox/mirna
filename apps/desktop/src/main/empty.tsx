import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";
import type { ReactNode } from "react";

import { Microphone, PencilSimpleLine } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { useLiveQuery } from "~/db";
import { FloatingChatCTA } from "~/shared/chat-cta";
import { StandardContentWrapper } from "~/shared/main";
import { useProcessingLocation } from "~/shared/processing-location";
import { useNewNote, useNewNoteAndListen } from "~/shared/useNewNote";
import { type Tab, useTabs } from "~/store/zustand/tabs";

type LastNoteRow = { id: string; title: string | null };

const LAST_NOTE_SQL = `
  SELECT id, title
  FROM sessions
  WHERE deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
`;

export function TabContentEmpty({
  tab: _tab,
}: {
  tab: Extract<Tab, { type: "empty" }>;
}) {
  return (
    <StandardContentWrapper
      floatingButton={
        <FloatingChatCTA
          label={<Trans>Ask about your notes</Trans>}
          scope={<Trans>All notes</Trans>}
        />
      }
    >
      <EmptyView />
    </StandardContentWrapper>
  );
}

export function greetingFor(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

function EmptyView() {
  const { t, i18n } = useLingui();
  const newNote = useNewNote({ behavior: "current" });
  const newNoteAndListen = useNewNoteAndListen({ behavior: "current" });
  const openCurrent = useTabs((state) => state.openCurrent);
  const location = useProcessingLocation();
  const primaryModifier = platform() === "macos" ? "⌘" : "Ctrl";
  const { data: lastNote } = useLiveQuery<LastNoteRow, LastNoteRow | null>({
    sql: LAST_NOTE_SQL,
    mapRows: (rows) => rows[0] ?? null,
  });

  const now = new Date();
  const greeting = {
    morning: t`Good morning`,
    afternoon: t`Good afternoon`,
    evening: t`Good evening`,
  }[greetingFor(now.getHours())];
  const dateLabel = now.toLocaleDateString(i18n.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const recordDescription = location.transcription?.local
    ? t`A meeting, a call or just you thinking out loud. Audio stays on this Mac.`
    : t`A meeting, a call or just you thinking out loud.`;

  return (
    <div
      data-tauri-drag-region
      className="flex h-full items-center justify-center px-8"
    >
      <div className="flex w-full max-w-[620px] flex-col gap-2">
        <p className="text-muted-foreground text-sm">{dateLabel}</p>
        <h1 className="font-brand text-mirna-wordmark text-[42px] leading-[1.1] font-normal tracking-[-0.012em]">
          {greeting}
        </h1>

        <div className="mt-6 grid grid-cols-2 gap-3.5">
          <HomeAction
            icon={<Microphone size={19} />}
            iconClassName="bg-mirna-terra/15 text-mirna-terra"
            title={<Trans>Start recording</Trans>}
            description={recordDescription}
            shortcut={`${primaryModifier}⇧N`}
            onClick={newNoteAndListen}
          />
          <HomeAction
            icon={<PencilSimpleLine size={19} />}
            iconClassName="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-mist"
            title={<Trans>Write a note</Trans>}
            description={t`Start on a blank page. You can add a recording to it later.`}
            shortcut={`${primaryModifier}N`}
            onClick={newNote}
          />
        </div>

        {lastNote ? (
          <button
            type="button"
            data-tauri-drag-region="false"
            onClick={() => openCurrent({ type: "sessions", id: lastNote.id })}
            className={cn([
              "bg-secondary hover:bg-accent mt-3.5 flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors",
            ])}
          >
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              <Trans>Last note</Trans>
            </span>
            <span
              className={cn([
                "min-w-0 flex-1 truncate text-sm font-medium",
                !lastNote.title && "text-muted-foreground italic",
              ])}
            >
              {lastNote.title || t`Untitled`}
            </span>
            <span className="text-mirna-wordmark text-[13px] font-semibold">
              <Trans>Open</Trans>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HomeAction({
  icon,
  iconClassName,
  title,
  description,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: ReactNode;
  description: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      onClick={onClick}
      className={cn([
        "group bg-card border-border flex min-h-[140px] flex-col gap-1.5 rounded-2xl border p-[18px] text-left",
        "hover:border-mirna-sage transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
      ])}
    >
      <span
        className={cn([
          "mb-1.5 flex size-[38px] items-center justify-center rounded-xl",
          iconClassName,
        ])}
      >
        {icon}
      </span>
      <span className="text-foreground text-[16.5px] font-semibold">
        {title}
      </span>
      <span className="text-muted-foreground text-[13.5px] leading-[1.45]">
        {description}
      </span>
      <kbd className="text-muted-foreground mt-auto self-end font-mono text-[11px]">
        {shortcut}
      </kbd>
    </button>
  );
}
