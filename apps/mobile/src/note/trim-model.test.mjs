import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampKeep,
  formatClock,
  formatLength,
  pcmRms,
  suggestKeep,
  trimChoices,
} from "./trim-model.ts";

const MIN = 60_000;

test("offers only the cuts that leave enough of the recording", () => {
  assert.deepEqual(
    trimChoices(20 * MIN).map((choice) => choice.minutes),
    [5, 10, 15],
  );
  assert.deepEqual(trimChoices(20 * MIN)[0], { minutes: 5, keepMs: 15 * MIN });
  assert.deepEqual(trimChoices(4 * MIN), []);
  assert.equal(trimChoices(125 * MIN).length, 5);
});

test("keeps at least 30 s and never more than the recording", () => {
  assert.equal(clampKeep(5_000, 10 * MIN), 30_000);
  assert.equal(clampKeep(20 * MIN, 10 * MIN), 10 * MIN);
  assert.equal(clampKeep(61_499, 10 * MIN), 61_000);
  assert.equal(clampKeep(5_000, 20_000), 20_000);
});

test("suggests a cut after the talking when a long quiet follows", () => {
  // 90 min sampled every 30 s: talking for 50 min, then pocket quiet.
  const levels = Array.from({ length: 180 }, (_, index) =>
    index < 100 ? (index % 3 === 0 ? 0.04 : 0.12) : 0.004,
  );
  const keep = suggestKeep(levels, 90 * MIN);
  assert.equal(keep, 50 * MIN + 30_000);
});

test("suggests nothing when the talking goes on to the end", () => {
  const levels = Array.from({ length: 120 }, (_, index) =>
    index % 2 === 0 ? 0.1 : 0.05,
  );
  assert.equal(suggestKeep(levels, 60 * MIN), null);
});

test("a single bump in the quiet doesn't count as talking", () => {
  const levels = Array.from({ length: 120 }, (_, index) =>
    index < 40 ? 0.1 : index === 100 ? 0.2 : 0.003,
  );
  assert.equal(suggestKeep(levels, 60 * MIN), 20 * MIN + 30_000);
});

test("steady noise isn't mistaken for talking", () => {
  // Wind or walking all the way through: the floor rises with it.
  const levels = Array.from({ length: 120 }, (_, index) =>
    index < 40 ? 0.3 : 0.06,
  );
  assert.equal(suggestKeep(levels, 60 * MIN), 20 * MIN + 30_000);
});

test("measures loudness of 16-bit PCM", () => {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, 16384, true);
  view.setInt16(2, -16384, true);
  view.setInt16(4, 16384, true);
  view.setInt16(6, -16384, true);
  assert.equal(pcmRms(bytes), 0.5);
  assert.equal(pcmRms(new Uint8Array(0)), 0);
});

test("formats lengths and cut points", () => {
  assert.equal(formatLength(45_000), "45 s");
  assert.equal(formatLength(12 * MIN), "12 min");
  assert.equal(formatLength(62 * MIN + 20_000), "1 h 02 min");
  assert.equal(formatClock(65_000), "1:05");
  assert.equal(formatClock(3_725_000), "1:02:05");
});
