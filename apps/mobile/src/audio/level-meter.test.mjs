import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVEL_BAR_COUNT,
  levelFromAmplitude,
  pushLevel,
} from "./level-meter.ts";

test("silence is flat and full scale is full", () => {
  assert.equal(levelFromAmplitude(0), 0);
  assert.equal(levelFromAmplitude(Number.NaN), 0);
  assert.equal(levelFromAmplitude(1), 1);
  assert.equal(levelFromAmplitude(2), 1);
  assert.equal(levelFromAmplitude(0.001), 0);
});

test("quiet speech still moves the strip", () => {
  const quiet = levelFromAmplitude(0.02);
  const loud = levelFromAmplitude(0.5);
  assert.ok(quiet > 0.2 && quiet < 0.8, `quiet ${quiet}`);
  assert.ok(loud > quiet);
});

test("keeps the newest levels, newest last", () => {
  let levels = [];
  for (let index = 1; index <= LEVEL_BAR_COUNT + 5; index++) {
    levels = pushLevel(levels, index);
  }
  assert.equal(levels.length, LEVEL_BAR_COUNT);
  assert.equal(levels[0], 6);
  assert.equal(levels.at(-1), LEVEL_BAR_COUNT + 5);

  const original = [1, 2];
  assert.deepEqual(pushLevel(original, 3, 2), [2, 3]);
  assert.deepEqual(original, [1, 2]);
});
