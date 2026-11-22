import { useLingui } from "@lingui/react/macro";
import { useState } from "react";

import {
  Laptop,
  Microphone,
  UploadSimple,
  Warning,
} from "@anlg/ui/components/icons";
import { DancingSticks } from "@anlg/ui/components/ui/dancing-sticks";
import { cn } from "@anlg/utils";

import { ExportModal } from "./overflow/export-modal";

import { formatRecordingLength } from "~/shared/format-recording-length";
import { usePermission } from "~/shared/hooks/usePermissions";
import type { EditorView } from "~/store/zustand/tabs/schema";
import { useListener } from "~/stt/contexts";

type ChannelHealth = boolean | null;

/** The first problem worth saying out loud while recording, or null. */
export function liveInputProblem({
  micPermission,
  systemAudioPermission,
  mic,
  speaker,
  unavailable,
}: {
  micPermission: string | undefined;
  systemAudioPermission: string | undefined;
  mic: ChannelHealth;
  speaker: ChannelHealth;
  unavailable: boolean;
}): "nothing" | "mic" | "mac-audio" | null {
  if (unavailable || (mic === false && speaker === false)) return "nothing";
  if (micPermission === "denied" || mic === false) return "mic";
  if (
    (systemAudioPermission && systemAudioPermission !== "authorized") ||
    speaker === false
  ) {
    return "mac-audio";
  }
  return null;
}

/** Timer, level, input health and Stop: the only control in Mirna that moves. */
export function LiveRecordingPill({ onStop }: { onStop: () => void }) {
  const { t } = useLingui();
  const { seconds, amplitude, captureHealth } = useListener((state) => ({
    seconds: state.live.seconds,
    amplitude: state.live.amplitude,
    captureHealth: state.live.captureHealth,
  }));
  const micPermission = usePermission("microphone");
  const systemAudioPermission = usePermission("systemAudio");
  const problem = liveInputProblem({
    micPermission: micPermission.status,
    systemAudioPermission: systemAudioPermission.status,
    mic: captureHealth.mic,
    speaker: captureHealth.speaker,
    unavailable: captureHealth.unavailable,
  });
  const problemLabel =
    problem === "nothing"
      ? t`No audio is being captured`
      : problem === "mic"
        ? t`Microphone is silent`
        : problem === "mac-audio"
          ? t`Mac audio is silent`
          : null;
  const fixPermission =
    problem === "mac-audio" ? systemAudioPermission : micPermission;
  const level = Math.max(
    0.25,
    Math.min(Math.hypot(amplitude?.mic ?? 0, amplitude?.speaker ?? 0), 1),
  );
  const micOk = problem !== "mic" && problem !== "nothing";
  const macAudioOk = problem !== "mac-audio" && problem !== "nothing";

  return (
    <div className="flex items-center gap-2" data-tauri-drag-region="false">
      {problemLabel ? (
        <div
          role="status"
          className="bg-mirna-terra/15 flex h-[34px] items-center gap-2 rounded-[10px] pr-1.5 pl-2.5 text-[13px] font-semibold text-[#8A3A1E] dark:text-[#E9A285]"
        >
          <Warning size={15} />
          {problemLabel}
          <button
            type="button"
            onClick={() => void fixPermission.open()}
            className="bg-background hover:bg-card rounded-[7px] px-2 py-1 text-[12.5px]"
          >
            {t`Fix`}
          </button>
        </div>
      ) : null}
      <div className="border-mirna-terra/30 bg-mirna-terra/10 flex h-9 items-center gap-2.5 rounded-xl border pr-1 pl-3">
        <span
          aria-hidden
          className="bg-mirna-terra animate-live-pulse size-[9px] rounded-full motion-reduce:animate-none"
        />
        <span
          aria-label={t`Recording time`}
          className="font-mono text-sm font-medium text-[#8A3A1E] tabular-nums dark:text-[#E9A285]"
        >
          {formatRecordingLength(seconds * 1000)}
        </span>
        <span aria-hidden className="text-mirna-terra flex items-center">
          <DancingSticks
            amplitude={level}
            color="currentColor"
            height={16}
            width={22}
            stickWidth={3}
            gap={2}
          />
        </span>
        <span
          className="flex items-center gap-1 px-1 text-[#6B4232] dark:text-[#E9A285]"
          title={t`Inputs being recorded`}
        >
          <Microphone
            size={14}
            aria-label={micOk ? t`Microphone on` : t`Microphone silent`}
            className={cn([!micOk && "opacity-40"])}
          />
          <Laptop
            size={14}
            aria-label={macAudioOk ? t`Mac audio on` : t`Mac audio silent`}
            className={cn([!macAudioOk && "opacity-40"])}
          />
        </span>
        <button
          type="button"
          onClick={onStop}
          className={cn([
            "bg-foreground text-background flex h-7 items-center gap-1.5 rounded-lg pr-2.5 pl-2 text-[13px] font-semibold",
            "hover:bg-foreground/85 transition-colors",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-hidden",
          ])}
        >
          <span aria-hidden className="bg-background size-2.5 rounded-[3px]" />
          {t`Stop`}
        </button>
      </div>
    </div>
  );
}

/** Shown instead of a record button while the note is transcribing or finishing. */
export function ProcessingStatus({
  sessionId,
  sessionMode,
}: {
  sessionId: string;
  sessionMode: string;
}) {
  const { t } = useLingui();
  const fraction = useListener((state) =>
    sessionMode === "running_batch"
      ? (state.batch[sessionId]?.percentage ?? null)
      : null,
  );
  // Batch progress is stored as a 0–1 fraction, like the transcript view reads it.
  const percent = fraction === null ? null : fraction * 100;
  const label =
    sessionMode === "running_batch" ? t`Transcribing` : t`Finishing up`;

  return (
    <div
      role="status"
      className="text-mirna-wordmark mr-1 flex flex-col items-end gap-1 px-1"
    >
      <span className="text-[13px] font-semibold">
        {label}
        {percent !== null ? (
          <span className="font-mono font-medium">
            {" "}
            · {Math.round(percent)}%
          </span>
        ) : null}
      </span>
      {percent !== null ? (
        <span
          aria-hidden
          className="bg-border flex h-1 w-36 overflow-hidden rounded-full"
        >
          <span
            className="bg-mirna-serra dark:bg-mirna-sage transition-[width]"
            style={{ width: `${Math.round(percent)}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}

/** Opens the export dialog directly, without going through the "…" menu. */
export function ShareButton({
  sessionId,
  currentView,
}: {
  sessionId: string;
  currentView: EditorView;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={t`Share or export`}
        title={t`Share or export`}
        data-tauri-drag-region="false"
        onClick={() => {
          setMounted(true);
          requestAnimationFrame(() => setOpen(true));
        }}
        className={cn([
          "text-muted-foreground hover:bg-accent hover:text-foreground flex size-[34px] items-center justify-center rounded-[9px] transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
        ])}
      >
        <UploadSimple size={18} />
      </button>
      {mounted ? (
        <ExportModal
          sessionId={sessionId}
          currentView={currentView}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
