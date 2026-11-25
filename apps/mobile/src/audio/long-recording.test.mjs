import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_IN_MS,
  LongRecordingWatch,
  PART_MS,
  PART_RETRY_MS,
  RECORDING_ALERTS,
  SILENCE_ALERT_MS,
  SILENCE_PAUSE_MS,
  partTitle,
} from "./long-recording.ts";

const MINUTE = 60_000;
const BUFFER_MS = 100;

/** Feeds buffers from `fromMs` to `toMs`; returns the actions with their times. */
function run(watch, fromMs, toMs, { speechEveryMs = 0 } = {}) {
  const actions = [];
  for (let at = fromMs + BUFFER_MS; at <= toMs; at += BUFFER_MS) {
    const speech = speechEveryMs > 0 && at % speechEveryMs === 0;
    for (const action of watch.onAudio(at, speech)) actions.push({ at, ...action });
  }
  return actions;
}

test("asks after 15 minutes of quiet and pauses after 30", () => {
  const watch = new LongRecordingWatch();
  const actions = run(watch, 0, 40 * MINUTE);
  assert.deepEqual(actions, [
    { at: SILENCE_ALERT_MS, type: "silence_alert" },
    { at: SILENCE_PAUSE_MS, type: "auto_pause", quietMs: SILENCE_PAUSE_MS },
  ]);
});

test("never alerts while people keep talking", () => {
  const watch = new LongRecordingWatch();
  const actions = run(watch, 0, 100 * MINUTE, { speechEveryMs: 5 * MINUTE });
  assert.deepEqual(actions, []);
});

test("speech after the heads-up clears it and restarts the clock", () => {
  const watch = new LongRecordingWatch();
  run(watch, 0, 20 * MINUTE);
  assert.deepEqual(watch.onAudio(20 * MINUTE + BUFFER_MS, true), [
    { type: "silence_over" },
  ]);
  const later = run(watch, 20 * MINUTE + BUFFER_MS, 55 * MINUTE);
  assert.deepEqual(later.map((action) => [action.type, action.at]), [
    ["silence_alert", 20 * MINUTE + BUFFER_MS + SILENCE_ALERT_MS],
    ["auto_pause", 20 * MINUTE + BUFFER_MS + SILENCE_PAUSE_MS],
  ]);
});

test("Keep going restarts the silence clock", () => {
  const watch = new LongRecordingWatch();
  run(watch, 0, 16 * MINUTE);
  watch.someoneIsThere();
  const actions = run(watch, 16 * MINUTE, 40 * MINUTE);
  assert.deepEqual(actions.map((action) => [action.type, action.at]), [
    ["silence_alert", 31 * MINUTE],
  ]);
});

test("paused time doesn't count as quiet", () => {
  const watch = new LongRecordingWatch();
  run(watch, 0, 10 * MINUTE);
  // Paused for an hour: no buffers, so recorded time stands still.
  const actions = run(watch, 10 * MINUTE, 14 * MINUTE);
  assert.deepEqual(actions, []);
});

test("buffers that arrive just after the automatic pause don't pause again", () => {
  const watch = new LongRecordingWatch();
  run(watch, 0, SILENCE_PAUSE_MS);
  assert.deepEqual(run(watch, SILENCE_PAUSE_MS, SILENCE_PAUSE_MS + 500), []);
});

test("checks in once at 2 hours, even while people talk", () => {
  const watch = new LongRecordingWatch();
  const actions = run(watch, 0, 2.9 * 60 * MINUTE, { speechEveryMs: MINUTE });
  assert.deepEqual(actions, [{ at: CHECK_IN_MS, type: "check_in" }]);
});

test("starts part 2 at 3 hours and part 3 three hours after that", () => {
  const watch = new LongRecordingWatch();
  const first = run(watch, 0, PART_MS + 10 * MINUTE, { speechEveryMs: MINUTE });
  assert.deepEqual(first.filter((action) => action.type === "next_part"), [
    { at: PART_MS, type: "next_part", part: 2 },
  ]);
  watch.partStarted();
  assert.equal(watch.currentPart, 2);
  const second = run(watch, PART_MS + 10 * MINUTE, 2 * PART_MS + 20 * MINUTE, {
    speechEveryMs: MINUTE,
  });
  assert.deepEqual(second, [
    { at: 2 * PART_MS + 10 * MINUTE, type: "next_part", part: 3 },
  ]);
});

test("asks for the next part once until the switch is done or fails", () => {
  const watch = new LongRecordingWatch();
  run(watch, 0, PART_MS, { speechEveryMs: MINUTE });
  const waiting = run(watch, PART_MS, PART_MS + 20 * MINUTE, {
    speechEveryMs: MINUTE,
  });
  assert.deepEqual(waiting, []);
  watch.partFailed();
  const retry = run(watch, PART_MS + 20 * MINUTE, PART_MS + 30 * MINUTE, {
    speechEveryMs: MINUTE,
  });
  assert.deepEqual(retry, [
    { at: PART_MS + 20 * MINUTE + PART_RETRY_MS, type: "next_part", part: 2 },
  ]);
});

test("names parts after the note, or Recording when it has no title", () => {
  assert.equal(partTitle("Standup", 2), "Standup (part 2)");
  assert.equal(partTitle("  Standup  ", 2), "Standup (part 2)");
  assert.equal(partTitle("Standup (part 2)", 3), "Standup (part 3)");
  assert.equal(partTitle("Standup (Part 12) ", 13), "Standup (part 13)");
  assert.equal(partTitle("", 2), "Recording (part 2)");
  assert.equal(partTitle("   ", 4), "Recording (part 4)");
  assert.equal(partTitle("(part 2)", 3), "Recording (part 3)");
  assert.equal(partTitle("Part 2 of the plan", 2), "Part 2 of the plan (part 2)");
});

test("alert copy is short, in sentence case and offers a way out", () => {
  for (const alert of Object.values(RECORDING_ALERTS)) {
    for (const text of [alert.title, alert.text]) {
      assert.ok(text.length <= 45, text);
      assert.equal(text[0], text[0].toUpperCase(), text);
      // Capitals only start a sentence.
      assert.doesNotMatch(text, /[^.?!]\s+[A-Z][a-z]/, text);
    }
    assert.ok(alert.actions.includes("stop"));
  }
});
