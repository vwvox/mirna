import assert from "node:assert/strict";
import test from "node:test";

import { recoveryNotice, wavDurationMs } from "./recovery-notice.ts";

test("measures the saved audio from the repaired WAV", () => {
  assert.equal(wavDurationMs(16_000 * 2 * 60, 16_000, 1), 60_000);
  assert.equal(wavDurationMs(48_000 * 4 * 10, 48_000, 2), 10_000);
  assert.equal(wavDurationMs(1_000, 0, 1), 0);
});

test("says how much of a killed recording was saved", () => {
  assert.deepEqual(recoveryNotice([41 * 60_000 + 10_000]), {
    title: "Recording stopped",
    description: "Android closed Mirna. 41 min was saved.",
  });
  assert.deepEqual(recoveryNotice([40_000]), {
    title: "Recording stopped",
    description: "Android closed Mirna. 40 sec was saved.",
  });
  assert.equal(
    recoveryNotice([200]).description,
    "Android closed Mirna. 1 sec was saved.",
  );
});

test("sums several recordings and stays quiet when none were saved", () => {
  assert.deepEqual(recoveryNotice([10 * 60_000, 5 * 60_000]), {
    title: "Recordings stopped",
    description: "Android closed Mirna. 2 recordings, 15 min in all, were saved.",
  });
  assert.equal(recoveryNotice([]), null);
});
