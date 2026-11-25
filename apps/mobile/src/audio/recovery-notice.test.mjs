import assert from "node:assert/strict";
import test from "node:test";

import { recoveryNotice, wavDurationMs } from "./recovery-notice.ts";

test("measures the saved audio from the repaired WAV", () => {
  assert.equal(wavDurationMs(16_000 * 2 * 60, 16_000, 1), 60_000);
  assert.equal(wavDurationMs(48_000 * 4 * 10, 48_000, 2), 10_000);
  assert.equal(wavDurationMs(1_000, 0, 1), 0);
});

test("says how much of a recording that hadn't finished saving is safe", () => {
  // Android closing Mirna and a failed save look the same on the next launch,
  // so the notice blames neither.
  assert.deepEqual(recoveryNotice([41 * 60_000 + 10_000]), {
    title: "Recording recovered",
    description: "41 min that hadn’t finished saving is safe now.",
  });
  assert.deepEqual(recoveryNotice([40_000]), {
    title: "Recording recovered",
    description: "40 sec that hadn’t finished saving is safe now.",
  });
  assert.equal(
    recoveryNotice([200]).description,
    "1 sec that hadn’t finished saving is safe now.",
  );
});

test("sums several recordings and stays quiet when none were saved", () => {
  assert.deepEqual(recoveryNotice([10 * 60_000, 5 * 60_000]), {
    title: "Recordings recovered",
    description:
      "2 recordings that hadn’t finished saving, 15 min in all, are safe now.",
  });
  assert.equal(recoveryNotice([]), null);
});
