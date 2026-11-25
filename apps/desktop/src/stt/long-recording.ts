// When a recording may have been forgotten: the silence watch, the 2 h
// check-in, and the pause that ends in a stop if nobody comes back. Recorded
// time is the recording's own clock (paused time doesn't count); how long an
// automatic pause has lasted is wall-clock time. Mirrors the phone's
// LongRecordingWatch, without its switch to a new note every 3 h.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** No speech for this long: ask whether it's still recording. */
export const SILENCE_ALERT_MS = 15 * MINUTE;
/** No speech and no Keep going for this long: pause. */
export const SILENCE_PAUSE_MS = 30 * MINUTE;
/** An automatic pause nobody answers ends with a stop and save. */
export const AUTO_PAUSE_STOP_AFTER_MS = 2 * HOUR;
/** One check-in this far into a recording, whatever it hears. */
export const CHECK_IN_MS = 2 * HOUR;

export type LongRecordingAction =
  | { type: "silence_alert" }
  | { type: "silence_over" }
  | { type: "auto_pause" }
  | { type: "check_in" }
  | { type: "auto_pause_expired" };

/** Decides, tick by tick, when to alert, pause or stop. One per recording. */
export class LongRecordingWatch {
  private recordedMs = 0;
  private heardAtMs = 0;
  private silenceAlerted = false;
  private checkedIn = false;
  private autoPausedAtMs: number | null = null;

  /** True from an automatic pause until someone resumes or it expires. */
  get autoPaused(): boolean {
    return this.autoPausedAtMs !== null;
  }

  /** Recorded time since speech was last heard or someone said Keep going. */
  get quietMs(): number {
    return this.recordedMs - this.heardAtMs;
  }

  /**
   * The recording's total recorded time, whether speech was heard since the
   * last tick, and the wall clock.
   */
  onTick(recordedMs: number, speech: boolean, nowMs: number) {
    const actions: LongRecordingAction[] = [];
    if (this.autoPausedAtMs !== null) {
      if (nowMs - this.autoPausedAtMs >= AUTO_PAUSE_STOP_AFTER_MS) {
        this.autoPausedAtMs = null;
        actions.push({ type: "auto_pause_expired" });
      }
      return actions;
    }

    this.recordedMs = Math.max(this.recordedMs, recordedMs);
    if (speech) {
      this.heardAtMs = this.recordedMs;
      if (this.silenceAlerted) {
        this.silenceAlerted = false;
        actions.push({ type: "silence_over" });
      }
    }
    const quiet = this.quietMs;
    if (quiet >= SILENCE_PAUSE_MS) {
      this.heardAtMs = this.recordedMs;
      this.silenceAlerted = false;
      this.autoPausedAtMs = nowMs;
      actions.push({ type: "auto_pause" });
    } else if (quiet >= SILENCE_ALERT_MS && !this.silenceAlerted) {
      this.silenceAlerted = true;
      actions.push({ type: "silence_alert" });
    }
    if (!this.checkedIn && this.recordedMs >= CHECK_IN_MS) {
      this.checkedIn = true;
      actions.push({ type: "check_in" });
    }
    return actions;
  }

  /**
   * Keep going, a pause or a resume: someone is there, so the silence clock
   * starts again and an automatic pause no longer ends in a stop.
   */
  someoneIsThere(): void {
    this.heardAtMs = this.recordedMs;
    this.silenceAlerted = false;
    this.autoPausedAtMs = null;
  }
}
