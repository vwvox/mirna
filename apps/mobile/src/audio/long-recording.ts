// When a recording may have been forgotten: the silence watch, the 2 h
// check-in and the switch to a new note every 3 h. Time here is recorded
// time (paused time doesn't count), measured from the audio itself, because
// JavaScript timers don't run while the phone is in a pocket and the buffers
// do. No React Native imports, so node's test runner can run it.

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
/** A recording carries on in a new note after this long, and again after each. */
export const PART_MS = 3 * HOUR;
/** A part switch that failed is tried again after this much more audio. */
export const PART_RETRY_MS = 5 * MINUTE;

export type RecordingAlertKind = "silence" | "check_in" | "paused";

/** Notification copy. Never includes the note title. */
export const RECORDING_ALERTS: Record<
  RecordingAlertKind,
  { title: string; text: string; actions: ("stop" | "keep_going" | "resume")[] }
> = {
  silence: {
    title: "Still recording?",
    text: "Nothing heard for 15 min",
    actions: ["stop", "keep_going"],
  },
  check_in: {
    title: "Recording for 2 h",
    text: "Still going?",
    actions: ["stop", "keep_going"],
  },
  paused: {
    title: "Paused after 30 min of quiet",
    text: "Nothing is lost. Resume to keep recording",
    actions: ["resume", "stop"],
  },
};

export type LongRecordingAction =
  | { type: "silence_alert" }
  | { type: "silence_over" }
  | { type: "auto_pause"; quietMs: number }
  | { type: "check_in" }
  | { type: "next_part"; part: number };

/**
 * Decides, buffer by buffer, when to alert, pause or start the next part.
 * One per recording; it spans all of the recording's parts.
 */
export class LongRecordingWatch {
  private recordedMs = 0;
  private heardAtMs = 0;
  private silenceAlerted = false;
  private checkedIn = false;
  private part = 1;
  private nextPartAtMs = PART_MS;
  private partPending = false;

  /** The part being recorded now, from 1. */
  get currentPart(): number {
    return this.part;
  }

  /** Recorded time since speech was last heard or someone said Keep going. */
  get quietMs(): number {
    return this.recordedMs - this.heardAtMs;
  }

  /**
   * After each buffer: the recording's total recorded time and whether the
   * buffer held speech.
   */
  onAudio(recordedMs: number, speech: boolean): LongRecordingAction[] {
    this.recordedMs = Math.max(this.recordedMs, recordedMs);
    const actions: LongRecordingAction[] = [];
    if (speech) {
      this.heardAtMs = this.recordedMs;
      if (this.silenceAlerted) {
        this.silenceAlerted = false;
        actions.push({ type: "silence_over" });
      }
    }
    const quiet = this.quietMs;
    if (quiet >= SILENCE_PAUSE_MS) {
      // Starts the clock again, so late buffers don't pause twice.
      this.heardAtMs = this.recordedMs;
      this.silenceAlerted = false;
      actions.push({ type: "auto_pause", quietMs: quiet });
    } else if (quiet >= SILENCE_ALERT_MS && !this.silenceAlerted) {
      this.silenceAlerted = true;
      actions.push({ type: "silence_alert" });
    }
    if (!this.checkedIn && this.recordedMs >= CHECK_IN_MS) {
      this.checkedIn = true;
      actions.push({ type: "check_in" });
    }
    if (!this.partPending && this.recordedMs >= this.nextPartAtMs) {
      this.partPending = true;
      actions.push({ type: "next_part", part: this.part + 1 });
    }
    return actions;
  }

  /**
   * Keep going, a pause or a resume: someone is there, so the silence clock
   * starts again.
   */
  someoneIsThere(): void {
    this.heardAtMs = this.recordedMs;
    this.silenceAlerted = false;
  }

  /** The next part has started at the current recorded time. */
  partStarted(): void {
    this.part += 1;
    this.partPending = false;
    this.nextPartAtMs = this.recordedMs + PART_MS;
  }

  /** The switch didn't happen; keep recording here and try again later. */
  partFailed(): void {
    this.partPending = false;
    this.nextPartAtMs = this.recordedMs + PART_RETRY_MS;
  }
}

const PART_SUFFIX = /\s*\(part \d+\)\s*$/i;

/** "Standup (part 2)", or "Recording (part 2)" for an untitled note. */
export function partTitle(title: string, part: number): string {
  const base = title.replace(PART_SUFFIX, "").trim() || "Recording";
  return `${base} (part ${part})`;
}
