import { useLingui } from "@lingui/react/macro";

import { ArrowsClockwise } from "@anlg/ui/components/icons";

import { useEnhancedNoteActions } from "~/session/components/note-input/enhanced-actions";
import {
  clearSummaryOutdated,
  useSummaryOutdated,
} from "~/session/summary-outdated";

/**
 * Shown above a summary written from a transcript that has since been redone.
 * Updating keeps the old summary in Version history.
 */
export function SummaryOutdatedNotice({
  sessionId,
  enhancedNoteId,
}: {
  sessionId: string;
  enhancedNoteId: string;
}) {
  const { t } = useLingui();
  const outdated = useSummaryOutdated(sessionId, enhancedNoteId);
  const { onRegenerate, isGenerating } = useEnhancedNoteActions({
    sessionId,
    enhancedNoteId,
  });
  if (!outdated || isGenerating) return null;

  return (
    <div
      role="status"
      data-summary-outdated
      className="bg-secondary text-foreground mx-2 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2.5 text-[13px]"
    >
      <ArrowsClockwise
        size={15}
        className="text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {t`The transcript was redone after this summary was written.`}
      </span>
      <button
        type="button"
        onClick={() => void clearSummaryOutdated(sessionId)}
        className="text-muted-foreground hover:text-foreground font-medium"
      >
        {t`Keep this one`}
      </button>
      <button
        type="button"
        onClick={() => {
          void clearSummaryOutdated(sessionId);
          void onRegenerate(null);
        }}
        className="bg-foreground text-background hover:bg-foreground/85 rounded-lg px-2.5 py-1 font-semibold"
      >
        {t`Update summary`}
      </button>
    </div>
  );
}
