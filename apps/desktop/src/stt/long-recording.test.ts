import { describe, expect, test } from "vitest";

import {
  AUTO_PAUSE_STOP_AFTER_MS,
  CHECK_IN_MS,
  LongRecordingWatch,
  SILENCE_ALERT_MS,
  SILENCE_PAUSE_MS,
} from "./long-recording";

const MINUTE = 60_000;

function types(actions: { type: string }[]) {
  return actions.map((action) => action.type);
}

describe("LongRecordingWatch", () => {
  test("asks once after 15 min of quiet, then pauses at 30", () => {
    const watch = new LongRecordingWatch();

    expect(watch.onTick(SILENCE_ALERT_MS - 1, false, 0)).toEqual([]);
    expect(types(watch.onTick(SILENCE_ALERT_MS, false, 0))).toEqual([
      "silence_alert",
    ]);
    expect(watch.onTick(20 * MINUTE, false, 0)).toEqual([]);
    expect(types(watch.onTick(SILENCE_PAUSE_MS, false, 1_000))).toEqual([
      "auto_pause",
    ]);
    expect(watch.autoPaused).toBe(true);
  });

  test("speech resets the quiet clock and ends an alert", () => {
    const watch = new LongRecordingWatch();

    watch.onTick(SILENCE_ALERT_MS, false, 0);
    expect(types(watch.onTick(16 * MINUTE, true, 0))).toEqual(["silence_over"]);
    expect(watch.quietMs).toBe(0);
    expect(watch.onTick(16 * MINUTE + SILENCE_ALERT_MS - 1, false, 0)).toEqual(
      [],
    );
  });

  test("Keep going starts the quiet clock again", () => {
    const watch = new LongRecordingWatch();

    watch.onTick(SILENCE_ALERT_MS, false, 0);
    watch.someoneIsThere();
    expect(watch.onTick(29 * MINUTE, false, 0)).toEqual([]);
    expect(types(watch.onTick(30 * MINUTE, false, 0))).toEqual([
      "silence_alert",
    ]);
  });

  test("an automatic pause nobody answers expires after 2 h", () => {
    const watch = new LongRecordingWatch();
    const pausedAt = 1_000_000;

    watch.onTick(SILENCE_PAUSE_MS, false, pausedAt);
    expect(
      watch.onTick(
        SILENCE_PAUSE_MS,
        false,
        pausedAt + AUTO_PAUSE_STOP_AFTER_MS - 1,
      ),
    ).toEqual([]);
    expect(
      types(
        watch.onTick(
          SILENCE_PAUSE_MS,
          false,
          pausedAt + AUTO_PAUSE_STOP_AFTER_MS,
        ),
      ),
    ).toEqual(["auto_pause_expired"]);
    expect(watch.autoPaused).toBe(false);
  });

  test("resuming after an automatic pause cancels the stop", () => {
    const watch = new LongRecordingWatch();

    watch.onTick(SILENCE_PAUSE_MS, false, 0);
    watch.someoneIsThere();
    expect(watch.autoPaused).toBe(false);
    expect(
      watch.onTick(SILENCE_PAUSE_MS + MINUTE, true, AUTO_PAUSE_STOP_AFTER_MS),
    ).toEqual([]);
  });

  test("checks in once at 2 h recorded, even while people talk", () => {
    const watch = new LongRecordingWatch();

    expect(watch.onTick(CHECK_IN_MS - 1, true, 0)).toEqual([]);
    expect(types(watch.onTick(CHECK_IN_MS, true, 0))).toEqual(["check_in"]);
    expect(watch.onTick(CHECK_IN_MS + MINUTE, true, 0)).toEqual([]);
  });
});
