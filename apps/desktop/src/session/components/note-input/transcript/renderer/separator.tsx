import { Trans } from "@lingui/react/macro";

import { cn } from "@anlg/utils";

import { formatTranscriptTime } from "./utils";

/** Where a later capture of the same note picks up. */
export function TranscriptSeparator({ resumedAtMs }: { resumedAtMs: number }) {
  return (
    <div
      role="separator"
      data-transcript-resumed
      className={cn([
        "flex items-center gap-3 px-2",
        "text-muted-foreground text-xs",
      ])}
    >
      <div className="border-border/50 flex-1 border-t" />
      <span className="flex items-baseline gap-1.5">
        <Trans>Recording resumed</Trans>
        <span className="font-mono text-[11px] tabular-nums">
          {formatTranscriptTime(resumedAtMs)}
        </span>
      </span>
      <div className="border-border/50 flex-1 border-t" />
    </div>
  );
}
