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

/** Why the native stream changed, as the patched expo-audio reports it. */
export type StreamChangeReason =
  | "app"
  | "notification"
  | "alert"
  | "paused_timeout"
  | "mic_error"
  | "released"
  | "service_ended";

/** Where a stop came from, for the problem log. */
export type StopSource =
  | "app_button"
  | "back"
  | "left_screen"
  | "delete"
  | "quick_action"
  | "retry"
  | "notification"
  | "alert"
  | "automatic"
  | "mic_lost"
  | "stream_released"
  | "service_ended"
  | "stream_ended";

/** A stop the native stream made on its own, by why it made it. */
export function stopSourceFromStream(reason: string | undefined): StopSource {
  switch (reason) {
    case "notification":
      return "notification";
    case "alert":
      return "alert";
    case "paused_timeout":
      return "automatic";
    case "mic_error":
      return "mic_lost";
    case "released":
      return "stream_released";
    case "service_ended":
      return "service_ended";
    default:
      return "stream_ended";
  }
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

/** Waits before each automatic retry of cataloging a finished recording. */
export const CATALOG_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/**
 * Runs `attempt`, and again after each delay while it keeps failing. Throws
 * the last error once the delays run out.
 */
export async function retryWithDelays<T>(
  attempt: (index: number) => Promise<T>,
  delaysMs: readonly number[],
  wait: (ms: number) => Promise<void>,
  onFailure?: (error: unknown, index: number, willRetry: boolean) => void,
): Promise<T> {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt(index);
    } catch (error) {
      const delay = delaysMs[index];
      onFailure?.(error, index, delay !== undefined);
      if (delay === undefined) throw error;
      await wait(delay);
    }
  }
}
