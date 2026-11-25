import { Trans, useLingui } from "@lingui/react/macro";

import { ChangelogContent } from "@anlg/changelog";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import { X } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import { useReleaseNotes } from "./data";
import { isNewSince, type Release } from "./releases";

import { useShell } from "~/contexts/shell";
import {
  useWindowControlsGutter,
  WINDOW_CONTROLS_GUTTER_PLUS_28_CLASS,
  WINDOW_CONTROLS_GUTTER_PLUS_80_CLASS,
} from "~/shared/hooks/useWindowControlsGutter";
import { StandardContentWrapper } from "~/shared/main";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export function TabContentChangelog({
  tab,
}: {
  tab: Extract<Tab, { type: "changelog" }>;
}) {
  const { current, previous } = tab.state;
  const { chat, leftsidebar } = useShell();
  const close = useTabs((state) => state.close);
  const showSidebarTimelineHeaderGutter = !leftsidebar.expanded;
  const showExpandedSidebarTimelineHeader = leftsidebar.expanded;

  useMountEffect(() => {
    if (chat.mode !== "FloatingClosed") {
      chat.sendEvent({ type: "CLOSE" });
    }
  });

  const releases = useReleaseNotes(current);

  return (
    <StandardContentWrapper>
      <div className="flex h-full flex-col">
        <div data-tauri-drag-region className="shrink-0 pr-1 pl-3">
          <ChangelogHeader
            showSidebarTimelineHeaderGutter={showSidebarTimelineHeaderGutter}
            showExpandedSidebarTimelineHeader={
              showExpandedSidebarTimelineHeader
            }
            onClose={() => close(tab)}
          />
        </div>

        <div className="relative mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="scroll-fade-y h-full overflow-y-auto px-3 pb-4">
            <ReleaseList
              releases={releases}
              current={current}
              previous={previous}
            />
          </div>
        </div>
      </div>
    </StandardContentWrapper>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className="text-blue-600 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-500/50 dark:hover:text-blue-300"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openerCommands.openUrl(href, null);
      }}
    >
      {children}
    </a>
  );
}

export function ReleaseList({
  releases,
  current,
  previous,
}: {
  releases: Release[];
  current: string;
  previous: string | null;
}) {
  if (releases.length === 0) {
    return (
      <p className="text-muted-foreground mx-auto max-w-[640px] pt-2">
        <Trans>No release notes yet.</Trans>
      </p>
    );
  }
  return (
    <div className="mx-auto flex max-w-[640px] flex-col divide-y">
      {releases.map((release) => (
        <ReleaseNotes
          key={release.version}
          release={release}
          isNew={isNewSince(release.version, previous, current)}
          isCurrent={release.version === current}
        />
      ))}
    </div>
  );
}

function ReleaseNotes({
  release,
  isNew,
  isCurrent,
}: {
  release: Release;
  isNew: boolean;
  isCurrent: boolean;
}) {
  const { i18n } = useLingui();
  const date = formatReleaseDate(release.date, i18n.locale);
  return (
    <section
      aria-label={release.version}
      data-release={release.version}
      className="flex flex-col gap-2 py-6 first:pt-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-foreground text-base font-semibold">
          {release.version}
        </h2>
        {isNew ? (
          <span className="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-mist rounded-md px-1.5 py-0.5 text-[11px] font-semibold">
            <Trans>New</Trans>
          </span>
        ) : isCurrent ? (
          <span className="text-muted-foreground rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
            <Trans>This version</Trans>
          </span>
        ) : null}
        {date ? (
          <span className="text-muted-foreground ml-auto text-xs">{date}</span>
        ) : null}
      </div>
      {release.summary ? (
        <p className="text-foreground text-sm leading-6 font-medium">
          {release.summary}
        </p>
      ) : null}
      <ChangelogContent
        content={release.content}
        components={{
          a: ({
            href,
            children,
          }: {
            href?: string;
            children?: React.ReactNode;
          }) =>
            href ? (
              <ExternalLink href={href}>{children}</ExternalLink>
            ) : (
              <>{children}</>
            ),
        }}
      />
    </section>
  );
}

/** "25 Nov 2026" in the app's language; the notes give "2026-11-25". */
export function formatReleaseDate(
  date: string | null,
  locale: string,
): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function ChangelogHeader({
  showExpandedSidebarTimelineHeader,
  showSidebarTimelineHeaderGutter,
  onClose,
}: {
  showExpandedSidebarTimelineHeader: boolean;
  showSidebarTimelineHeaderGutter: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const showWindowControlsGutter = useWindowControlsGutter();
  return (
    <div
      data-tauri-drag-region
      className={cn([
        "relative flex h-12 w-full items-center",
        showSidebarTimelineHeaderGutter &&
          (showWindowControlsGutter
            ? WINDOW_CONTROLS_GUTTER_PLUS_80_CLASS
            : "pl-[80px]"),
      ])}
    >
      <div
        data-tauri-drag-region
        className={cn([
          "pointer-events-none absolute inset-y-0 flex items-center",
          showExpandedSidebarTimelineHeader
            ? "right-[70px] left-0 justify-start"
            : showSidebarTimelineHeaderGutter
              ? cn([
                  "right-[70px] justify-start",
                  showWindowControlsGutter
                    ? WINDOW_CONTROLS_GUTTER_PLUS_28_CLASS
                    : "left-[28px]",
                ])
              : "left-1/2 w-[min(640px,calc(100%_-_160px))] -translate-x-1/2 justify-center",
        ])}
      >
        <h1
          className={cn([
            "text-foreground truncate text-xl font-semibold",
            showExpandedSidebarTimelineHeader || showSidebarTimelineHeaderGutter
              ? "text-left"
              : "text-center",
          ])}
        >
          <Trans>What's new in Mirna</Trans>
        </h1>
      </div>

      <div className="relative z-10 ml-auto flex shrink-0 items-center gap-0 pr-1">
        <Button
          size="icon"
          variant="ghost"
          data-tauri-drag-region="false"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t`Close What's new`}
          title={t`Close`}
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>
    </div>
  );
}
