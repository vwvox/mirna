import { Trans, useLingui } from "@lingui/react/macro";
import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { Pause, Play, Warning } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { Switch } from "@anlg/ui/components/ui/switch";
import { toast } from "@anlg/ui/components/ui/toast";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";
import { cn } from "@anlg/utils";

import { type ClipPlayer, createClipPlayer } from "~/audio-player/clip";
import { useAudioPlayer, useAudioTime } from "~/audio-player/provider";
import { reloadSessionAudio } from "~/audio-player/reload";
import { isUsablePeaks, loadSessionPeaks } from "~/audio-player/waveform";
import { getEnhancerService } from "~/services/enhancer";
import { hasStoredNoteContent } from "~/session/components/shared";
import { useEnhancedNoteRecords } from "~/session/queries";
import {
  clearSummaryOutdated,
  markSummaryOutdated,
} from "~/session/summary-outdated";
import {
  clampKeep,
  formatClock,
  lengthParts,
  MIN_CUT_MS,
  suggestKeep,
  type TrimBlocker,
  trimBlocker,
  trimChoices,
  waveformBars,
} from "~/session/trim-model";
import {
  loadTrimContext,
  TrimRefusedError,
  trimSessionRecording,
} from "~/session/trim-recording";
import { useListener } from "~/stt/contexts";

const BARS = 96;
const PREVIEW_MS = 5_000;

type TrimRequest = { keepMs: number; cutMs: number; rewriteSummary: boolean };
type TrimMutation = UseMutationResult<void, Error, TrimRequest>;

/** Cuts the end off a recording that ran on, from the note's … menu. */
export function TrimRecordingDialog({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const formatLength = useFormatLength();
  const queryClient = useQueryClient();
  const { stop } = useAudioPlayer();

  const trim = useMutation({
    mutationFn: async ({ keepMs }: TrimRequest) => {
      stop();
      await trimSessionRecording(sessionId, keepMs, { requestedBy: "mac" });
    },
    onSuccess: (_, { cutMs, rewriteSummary }) => {
      reloadSessionAudio(queryClient, sessionId);
      void updateSummaryAfterTrim(sessionId, rewriteSummary).catch(
        (error: unknown) => {
          console.error("[trim] could not update the summary", error);
        },
      );
      const cut = formatLength(cutMs);
      toast.success(t`Recording trimmed`, {
        id: `trim-recording-${sessionId}`,
        description: t`Cut the last ${cut}.`,
      });
      onOpenChange(false);
    },
    onError: (error) => {
      // Part of the work may have been done; show what is on disk now.
      if (!(error instanceof TrimRefusedError)) {
        reloadSessionAudio(queryClient, sessionId);
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!trim.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="w-full max-w-md gap-5">
        <DialogHeader>
          <DialogTitle className="text-base">
            <Trans>Trim recording</Trans>
          </DialogTitle>
        </DialogHeader>
        <TrimBody
          sessionId={sessionId}
          trim={trim}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

async function updateSummaryAfterTrim(sessionId: string, rewrite: boolean) {
  if (!rewrite) {
    await markSummaryOutdated(sessionId);
    return;
  }
  await clearSummaryOutdated(sessionId);
  await getEnhancerService()?.requestAutoEnhance(sessionId, "refresh");
}

function TrimBody({
  sessionId,
  trim,
  onClose,
}: {
  sessionId: string;
  trim: TrimMutation;
  onClose: () => void;
}) {
  const time = useAudioTime();
  // gcTime 0: each opening reads the recording as it is now, so the starting
  // cut is never worked out from a length that a trim already changed.
  const peaks = useQuery({
    queryKey: ["audio", sessionId, "peaks"],
    queryFn: () => loadSessionPeaks(sessionId),
    gcTime: 0,
  });
  const context = useQuery({
    queryKey: ["audio", sessionId, "trim-context"],
    queryFn: () => loadTrimContext(sessionId),
    gcTime: 0,
  });

  if (peaks.isPending || context.isPending) {
    return (
      <DialogDescription>
        <Trans>Reading the recording…</Trans>
      </DialogDescription>
    );
  }

  const peaksData = peaks.data ?? null;
  const usablePeaks = isUsablePeaks(peaksData) ? peaksData : null;
  const lengthMs = Math.round((usablePeaks?.duration ?? time.total) * 1000);
  if (context.isError || !(lengthMs > 0)) {
    return (
      <Blocked onClose={onClose}>
        <Trans>Couldn't read this recording.</Trans>
      </Blocked>
    );
  }

  const blocker = trimBlocker({
    lengthMs,
    transcriptCount: context.data.transcriptCount,
    fromPhone: context.data.fromPhone,
  });
  if (blocker) {
    return (
      <Blocked onClose={onClose}>
        <BlockerMessage blocker={blocker} />
      </Blocked>
    );
  }

  return (
    <TrimControls
      sessionId={sessionId}
      lengthMs={lengthMs}
      channels={usablePeaks?.channels ?? null}
      talkEndsMs={context.data.talkEndsMs}
      trim={trim}
      onCancel={onClose}
    />
  );
}

function BlockerMessage({ blocker }: { blocker: TrimBlocker }) {
  switch (blocker) {
    case "several_parts":
      return (
        <Trans>
          This note was recorded in more than one part, so it can't be trimmed
          yet.
        </Trans>
      );
    case "from_phone":
      return (
        <Trans>
          This recording came from your phone. Trim it in Mirna on your phone
          instead, so both copies stay the same. The phone trims the copy on
          this Mac too.
        </Trans>
      );
    case "too_short":
      return <Trans>This recording is too short to trim.</Trans>;
  }
}

function Blocked({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <DialogDescription className="text-foreground">
        {children}
      </DialogDescription>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
      </DialogFooter>
    </>
  );
}

function TrimControls({
  sessionId,
  lengthMs,
  channels,
  talkEndsMs,
  trim,
  onCancel,
}: {
  sessionId: string;
  lengthMs: number;
  channels: number[][] | null;
  talkEndsMs: number | null;
  trim: TrimMutation;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const formatLength = useFormatLength();
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const hasSummary = useEnhancedNoteRecords(sessionId).some((note) =>
    hasStoredNoteContent(note.content),
  );
  const suggestion = suggestKeep(talkEndsMs, lengthMs);
  const choices = trimChoices(lengthMs);
  const [keepMs, setKeepMs] = useState(
    () => suggestion?.keepMs ?? choices[0]?.keepMs ?? lengthMs,
  );
  const [rewriteSummary, setRewriteSummary] = useState(true);
  const preview = useCutPreview(sessionId);
  const cutMs = Math.max(0, lengthMs - keepMs);
  const tooLittle = cutMs < MIN_CUT_MS;
  const length = formatClock(lengthMs);
  const end = formatClock(keepMs);
  const cut = formatLength(cutMs);

  const choose = (next: number) => {
    preview.stop();
    setKeepMs(next);
  };

  return (
    <>
      <DialogDescription>
        <Trans>
          This recording is {length} long. Choose where it should end.
        </Trans>
      </DialogDescription>

      {suggestion && (
        <SuggestedEnd
          talkEndsMs={suggestion.talkEndsMs}
          selected={keepMs === suggestion.keepMs}
          onChoose={() => choose(suggestion.keepMs)}
        />
      )}

      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((choice) => {
            const selected = choice.keepMs === keepMs;
            const minutes = choice.minutes;
            return (
              <button
                key={minutes}
                type="button"
                aria-pressed={selected}
                aria-label={t`Cut the last ${minutes} minutes`}
                onClick={() => choose(choice.keepMs)}
                className={cn([
                  "h-7 rounded-lg border px-2.5 text-xs font-medium tabular-nums transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
                  selected
                    ? "border-mirna-terra/50 bg-mirna-terra/10 text-[#8A3A1E] dark:text-[#E9A285]"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                ])}
              >
                {t`−${minutes} min`}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <CutSlider
          lengthMs={lengthMs}
          keepMs={keepMs}
          channels={channels}
          onChange={choose}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs font-medium tabular-nums">
            <Trans>
              Ends at {end} · cuts {cut}
            </Trans>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={preview.loading}
            onClick={() => preview.toggle(keepMs)}
          >
            {preview.playing ? <Pause /> : <Play />}
            {preview.playing
              ? t`Stop`
              : preview.loading
                ? t`Loading…`
                : t`Play the 5 s before the end`}
          </Button>
        </div>
        {preview.failed && (
          <p role="alert" className="text-xs text-red-500">
            <Trans>Couldn't play the recording.</Trans>
          </p>
        )}
      </div>

      {hasSummary && (
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <Trans>Write the summary again too</Trans>
          <Switch
            size="sm"
            checked={rewriteSummary}
            onCheckedChange={setRewriteSummary}
          />
        </label>
      )}

      <p className="text-muted-foreground flex gap-2 text-xs leading-5">
        <Warning className="text-mirna-terra mt-0.5 size-3.5 shrink-0" />
        <span>
          <Trans>
            The cut part is deleted from this Mac, with its words in the
            transcript. This can't be undone.
          </Trans>
        </span>
      </p>

      {trim.error && (
        <p role="alert" className="text-xs text-red-500">
          <TrimErrorMessage error={trim.error} />
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={trim.isPending}
          onClick={onCancel}
        >
          <Trans>Cancel</Trans>
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={trim.isPending || tooLittle || sessionMode !== "inactive"}
          onClick={() => {
            preview.stop();
            trim.mutate({
              keepMs,
              cutMs,
              rewriteSummary: hasSummary ? rewriteSummary : true,
            });
          }}
        >
          {trim.isPending
            ? t`Trimming…`
            : tooLittle
              ? t`Choose where it ends`
              : t`Cut the last ${cut}`}
        </Button>
      </DialogFooter>
    </>
  );
}

function TrimErrorMessage({ error }: { error: Error }) {
  if (error instanceof TrimRefusedError) {
    return <BlockerMessage blocker={error.reason} />;
  }
  return <Trans>Couldn't trim this recording.</Trans>;
}

function SuggestedEnd({
  talkEndsMs,
  selected,
  onChoose,
}: {
  talkEndsMs: number;
  selected: boolean;
  onChoose: () => void;
}) {
  const stops = formatClock(talkEndsMs);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onChoose}
      className={cn([
        "rounded-lg border px-3 py-2.5 text-left text-xs leading-5 transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        "bg-mirna-moss/50 dark:bg-mirna-serra/30 hover:bg-mirna-moss/80 dark:hover:bg-mirna-serra/45",
        selected
          ? "border-mirna-serra/40 dark:border-mirna-sage/40"
          : "border-transparent",
      ])}
    >
      <Trans>The talking seems to stop around {stops}.</Trans>{" "}
      <span className="text-mirna-serra dark:text-mirna-sage font-semibold">
        <Trans>End it there</Trans>
      </span>
    </button>
  );
}

/** The recording's waveform, the part to cut dimmed, and a handle to drag. */
function CutSlider({
  lengthMs,
  keepMs,
  channels,
  onChange,
}: {
  lengthMs: number;
  keepMs: number;
  channels: number[][] | null;
  onChange: (keepMs: number) => void;
}) {
  const { t } = useLingui();
  const bars = useMemo(
    () => (channels ? waveformBars(channels, BARS) : []),
    [channels],
  );
  const fraction = lengthMs > 0 ? Math.min(1, keepMs / lengthMs) : 1;
  const percent = `${fraction * 100}%`;

  return (
    <div
      className={cn([
        "border-border bg-card relative h-16 overflow-hidden rounded-lg border",
        "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2",
      ])}
    >
      <div className="pointer-events-none absolute inset-x-0 inset-y-2 flex items-center gap-px">
        {bars.map((height, index) => (
          <div
            key={index}
            className={cn([
              "flex-1 rounded-[1px]",
              (index + 0.5) / BARS > fraction
                ? "bg-muted-foreground/25"
                : "bg-mirna-serra/80 dark:bg-mirna-sage/80",
            ])}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        ))}
      </div>
      <div
        className="bg-foreground/5 pointer-events-none absolute inset-y-0 right-0"
        style={{ left: percent }}
      />
      <div
        className="bg-mirna-terra pointer-events-none absolute inset-y-0 -ml-px w-[3px]"
        style={{ left: percent }}
      />
      <input
        type="range"
        min={0}
        max={lengthMs}
        step={1000}
        value={keepMs}
        aria-label={t`Where the recording ends`}
        aria-valuetext={formatClock(keepMs)}
        onChange={(event) =>
          onChange(clampKeep(Number(event.target.value), lengthMs))
        }
        className={cn([
          "absolute inset-0 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0",
          "[&::-webkit-slider-thumb]:h-16 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none",
        ])}
      />
    </div>
  );
}

/** Plays the few seconds before a cut, to hear where the recording ends. */
function useCutPreview(sessionId: string) {
  const { state, pause } = useAudioPlayer();
  const clip = useRef<ClipPlayer | null>(null);
  const mounted = useRef(true);
  const [playing, setPlaying] = useState(false);

  useMountEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clip.current?.dispose();
      clip.current = null;
    };
  });

  const play = useMutation({
    mutationFn: async (endMs: number) => {
      if (!clip.current) {
        const path = await fsSyncCommands.audioPath(sessionId);
        if (path.status === "error") throw new Error(path.error);
        const created = await createClipPlayer(
          convertFileSrc(path.data),
          setPlaying,
        );
        if (!mounted.current) {
          created.dispose();
          return;
        }
        clip.current = created;
      }
      if (state === "playing") pause();
      await clip.current.play(Math.max(0, endMs - PREVIEW_MS), endMs);
    },
  });

  return {
    playing,
    loading: play.isPending && !playing,
    failed: play.isError,
    toggle: (endMs: number) => {
      if (playing) clip.current?.stop();
      else play.mutate(endMs);
    },
    stop: () => clip.current?.stop(),
  };
}

/** "45 s", "12 min", "1 h 02 min". */
function useFormatLength() {
  const { t } = useLingui();
  return (ms: number) => {
    const parts = lengthParts(ms);
    if ("seconds" in parts) {
      const seconds = parts.seconds;
      return t`${seconds} s`;
    }
    const { hours, minutes } = parts;
    if (hours === 0) return t`${minutes} min`;
    const paddedMinutes = String(minutes).padStart(2, "0");
    return t`${hours} h ${paddedMinutes} min`;
  };
}
