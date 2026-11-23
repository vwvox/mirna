export type RecorderPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "saving"
  | "saved"
  | "unavailable"
  | "interrupted"
  | "save_error"
  | "error";

export function isRecordingStartCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_AUDIO_STREAM_START_CANCELLED"
  );
}

/** The mic is on, about to be, or paused mid-recording. */
export function isCapturePhase(phase: RecorderPhase): boolean {
  return phase === "starting" || phase === "recording" || phase === "paused";
}

/**
 * What a native stream status means for the recorder. The stream can end
 * under us ("Stop & save" in the notification, or Android), and it can be
 * paused or resumed from the notification while the app is in the background.
 */
export function phaseAfterStreamStatus(
  phase: RecorderPhase,
  status: { isStreaming: boolean; isPaused?: boolean },
): RecorderPhase | "stop" | null {
  if (!status.isStreaming) return isCapturePhase(phase) ? "stop" : null;
  if (status.isPaused === true && phase === "recording") return "paused";
  if (status.isPaused === false && phase === "paused") return "recording";
  return null;
}

/** "04:07" or "1:02:09", the same as Android's notification timer. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minutesAndSeconds = `${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${minutesAndSeconds}` : minutesAndSeconds;
}

/** A recording length for screen readers: "12 minutes 4 seconds". */
export function describeElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  }
  return parts.join(" ");
}
