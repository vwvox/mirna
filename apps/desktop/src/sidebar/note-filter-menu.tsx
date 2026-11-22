import { Trans, useLingui } from "@lingui/react/macro";

import {
  CalendarBlank,
  CaretDown,
  Check,
  FolderSimple,
  SlidersHorizontal,
  SortAscending,
  SortDescending,
} from "@anlg/ui/components/icons";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";
import { cn } from "@anlg/utils";

import { useSidebarNotes } from "./note-filter";

import { useLiveQuery } from "~/db";

export function SidebarNoteFilterMenu() {
  const { t } = useLingui();
  const groupBy = useSidebarNotes((state) => state.groupBy);
  const sortOrder = useSidebarNotes((state) => state.sortOrder);
  const setGroupBy = useSidebarNotes((state) => state.setGroupBy);
  const setSortOrder = useSidebarNotes((state) => state.setSortOrder);
  const isDefaultView = groupBy === "date" && sortOrder === "newest";
  const groupingLabel = groupBy === "folder" ? t`Folder` : t`Date`;
  const orderingLabel = sortOrder === "oldest" ? t`Oldest` : t`Newest`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t`Group and sort`}
          title={t`Group and sort`}
          data-tauri-drag-region="false"
          className={cn([
            "pointer-events-auto relative flex size-[30px] items-center justify-center rounded-lg",
            "text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
            "focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-hidden",
            !isDefaultView && "text-mirna-wordmark bg-accent",
          ])}
        >
          <SlidersHorizontal size={17} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent variant="app" align="start" className="w-56">
        <AppFloatingPanel className={appFloatingMenuPanelClassName}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              aria-label={t`Grouping, ${groupingLabel}`}
              className="cursor-pointer"
            >
              <span className="flex-1">
                <Trans>Grouping</Trans>
              </span>
              <span className="text-muted-foreground">{groupingLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent variant="app" className="w-44">
                <AppFloatingPanel className={appFloatingMenuPanelClassName}>
                  <DropdownMenuItem
                    onSelect={() => setGroupBy("date")}
                    className="cursor-pointer"
                  >
                    <CalendarBlank
                      className="size-4 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <Trans>Date</Trans>
                    </span>
                    {groupBy === "date" ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setGroupBy("folder")}
                    className="cursor-pointer"
                  >
                    <FolderSimple
                      className="size-4 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <Trans>Folder</Trans>
                    </span>
                    {groupBy === "folder" ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                </AppFloatingPanel>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              aria-label={t`Ordering, ${orderingLabel}`}
              className="cursor-pointer"
            >
              <span className="flex-1">
                <Trans>Ordering</Trans>
              </span>
              <span className="text-muted-foreground">{orderingLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent variant="app" className="w-44">
                <AppFloatingPanel className={appFloatingMenuPanelClassName}>
                  <DropdownMenuItem
                    onSelect={() => setSortOrder("newest")}
                    className="cursor-pointer"
                  >
                    <SortDescending
                      className="size-4 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <Trans>Newest</Trans>
                    </span>
                    {sortOrder === "newest" ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setSortOrder("oldest")}
                    className="cursor-pointer"
                  >
                    <SortAscending
                      className="size-4 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <Trans>Oldest</Trans>
                    </span>
                    {sortOrder === "oldest" ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                </AppFloatingPanel>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </AppFloatingPanel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type FolderRow = { folder_path: string };

const FOLDERS_SQL = `
  SELECT DISTINCT folder_path
  FROM sessions
  WHERE deleted_at IS NULL AND folder_path IS NOT NULL AND folder_path <> ''
  ORDER BY folder_path
`;

export function folderLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** "All notes ▾": which notes the list shows, everything or one folder. */
export function SidebarScopeMenu() {
  const { t } = useLingui();
  const noteFilter = useSidebarNotes((state) => state.noteFilter);
  const folderFilter = useSidebarNotes((state) => state.folderFilter);
  const setView = useSidebarNotes((state) => state.setView);
  const { data: folders = [] } = useLiveQuery<FolderRow, string[]>({
    sql: FOLDERS_SQL,
    mapRows: (rows) => rows.map((row) => row.folder_path),
  });
  const activeFolder = noteFilter === "mine" ? folderFilter : null;
  const label = activeFolder ? folderLabel(activeFolder) : t`All notes`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t`Show notes: ${label}`}
          data-tauri-drag-region="false"
          className={cn([
            "text-foreground hover:bg-accent flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13.5px] font-semibold transition-colors",
            "focus-visible:bg-accent focus-visible:outline-hidden",
          ])}
        >
          <span className="max-w-40 truncate">{label}</span>
          <CaretDown size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent variant="app" align="start" className="w-56">
        <AppFloatingPanel className={appFloatingMenuPanelClassName}>
          <DropdownMenuItem
            onSelect={() => setView("mine", null)}
            className="cursor-pointer"
          >
            <span className="flex-1">
              <Trans>All notes</Trans>
            </span>
            {activeFolder === null ? (
              <Check className="size-4" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
          {folders.map((folder) => (
            <DropdownMenuItem
              key={folder}
              onSelect={() => setView("mine", folder)}
              className="cursor-pointer"
            >
              <FolderSimple
                className="size-4 shrink-0 opacity-70"
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{folderLabel(folder)}</span>
              {activeFolder === folder ? (
                <Check className="size-4" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}
          {folders.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              <Trans>Folders appear here once notes are filed.</Trans>
            </p>
          ) : null}
        </AppFloatingPanel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
