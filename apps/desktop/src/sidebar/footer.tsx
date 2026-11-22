import { useLingui } from "@lingui/react/macro";

import { Cloud, Gear, Laptop } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import {
  type ProcessingLocation,
  useProcessingLocation,
} from "~/shared/processing-location";
import { useTabs } from "~/store/zustand/tabs";

export function processingHeadline(
  location: ProcessingLocation,
): "local" | "notes-cloud" | "transcription-cloud" | "cloud" | "unset" {
  const { transcription, notes } = location;
  if (!transcription && !notes) return "unset";
  if (location.allLocal) return "local";
  const transcriptionLocal = transcription?.local ?? true;
  const notesLocal = notes?.local ?? true;
  if (transcriptionLocal && !notesLocal) return "notes-cloud";
  if (!transcriptionLocal && notesLocal) return "transcription-cloud";
  return "cloud";
}

/** Where recordings are processed, and Settings, at the foot of the sidebar. */
export function SidebarFooter() {
  const { t } = useLingui();
  const openCurrent = useTabs((state) => state.openCurrent);
  const location = useProcessingLocation();
  const headline = processingHeadline(location);
  const isLocal = headline === "local";
  const title = {
    local: t`On this Mac`,
    "notes-cloud": t`Cloud notes`,
    "transcription-cloud": t`Cloud transcription`,
    cloud: t`Cloud`,
    unset: t`Choose models`,
  }[headline];
  const detail = [location.transcription?.label, location.notes?.label]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border-border flex h-14 shrink-0 items-center gap-2 border-t pr-2.5 pl-3">
      <button
        type="button"
        onClick={() =>
          openCurrent({
            type: "settings",
            state: {
              tab:
                location.transcription?.local === false
                  ? "transcription"
                  : "intelligence",
            },
          })
        }
        className={cn([
          "hover:bg-accent flex min-w-0 items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-1 text-left transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        ])}
      >
        <span
          className={cn([
            "flex size-[30px] shrink-0 items-center justify-center rounded-lg",
            isLocal
              ? "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-mist"
              : "bg-secondary text-foreground",
          ])}
        >
          {isLocal ? <Laptop size={16} /> : <Cloud size={16} />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={cn([
              "truncate text-[13px] font-semibold",
              isLocal ? "text-mirna-wordmark" : "text-foreground",
            ])}
          >
            {title}
          </span>
          {detail ? (
            <span className="text-muted-foreground truncate text-[11.5px]">
              {detail}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        aria-label={t`Settings`}
        title={t`Settings`}
        onClick={() => openCurrent({ type: "settings" })}
        className={cn([
          "text-muted-foreground hover:bg-accent hover:text-foreground ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        ])}
      >
        <Gear size={18} />
      </button>
    </div>
  );
}
