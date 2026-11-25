import assert from "node:assert/strict";
import test from "node:test";

import {
  describeElapsed,
  formatElapsed,
  isCapturePhase,
  isRecordingStartCancelled,
  phaseAfterStreamStatus,
  retryWithDelays,
  stopSourceFromStream,
} from "./recorder-status.ts";

test("recognizes a native stop during recording startup as cancellation", () => {
  const error = Object.assign(new Error("Audio stream startup was cancelled"), {
    code: "ERR_AUDIO_STREAM_START_CANCELLED",
  });
  assert.equal(isRecordingStartCancelled(error), true);
});

test("keeps initialization and permission failures on the error path", () => {
  for (const error of [
    { code: "ERR_AUDIO_STREAM_INITIALIZATION" },
    { code: "ERR_AUDIO_RECORDING_SERVICE" },
    { code: "ERR_AUDIO_PERMISSIONS" },
    new Error("Audio stream startup was cancelled"),
    null,
    undefined,
  ]) {
    assert.equal(isRecordingStartCancelled(error), false);
  }
});

test("a paused recording still counts as capturing", () => {
  assert.equal(isCapturePhase("starting"), true);
  assert.equal(isCapturePhase("recording"), true);
  assert.equal(isCapturePhase("paused"), true);
  for (const phase of [
    "idle",
    "saving",
    "saved",
    "unavailable",
    "interrupted",
    "save_error",
    "error",
  ]) {
    assert.equal(isCapturePhase(phase), false);
  }
});

test("a pause or resume from the notification moves the recorder with it", () => {
  assert.equal(
    phaseAfterStreamStatus("recording", { isStreaming: true, isPaused: true }),
    "paused",
  );
  assert.equal(
    phaseAfterStreamStatus("paused", { isStreaming: true, isPaused: false }),
    "recording",
  );
  // Repeated or unrelated statuses change nothing.
  assert.equal(
    phaseAfterStreamStatus("paused", { isStreaming: true, isPaused: true }),
    null,
  );
  assert.equal(
    phaseAfterStreamStatus("starting", { isStreaming: true, isPaused: false }),
    null,
  );
  assert.equal(
    phaseAfterStreamStatus("saving", { isStreaming: true, isPaused: true }),
    null,
  );
  // iOS sends no pause state.
  assert.equal(phaseAfterStreamStatus("recording", { isStreaming: true }), null);
});

test("a stream that ends under a recording, even a paused one, saves it", () => {
  for (const phase of ["starting", "recording", "paused"]) {
    assert.equal(
      phaseAfterStreamStatus(phase, { isStreaming: false, isPaused: false }),
      "stop",
    );
  }
  for (const phase of ["idle", "saving", "saved", "error"]) {
    assert.equal(phaseAfterStreamStatus(phase, { isStreaming: false }), null);
  }
});

test("elapsed time reads like the notification timer", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(999), "00:00");
  assert.equal(formatElapsed(65_000), "01:05");
  assert.equal(formatElapsed(12 * 60_000 + 4_000), "12:04");
  assert.equal(formatElapsed(3_600_000 + 2 * 60_000 + 9_000), "1:02:09");
  assert.equal(formatElapsed(-5), "00:00");
});

test("elapsed time has a spoken form", () => {
  assert.equal(describeElapsed(0), "0 seconds");
  assert.equal(describeElapsed(1_000), "1 second");
  assert.equal(describeElapsed(12 * 60_000 + 4_000), "12 minutes 4 seconds");
  assert.equal(describeElapsed(3_600_000 + 60_000), "1 hour 1 minute");
});

test("retries a failing step after each delay, then gives up with its error", async () => {
  const waits = [];
  const failures = [];
  let calls = 0;
  await assert.rejects(
    retryWithDelays(
      async () => {
        calls += 1;
        throw new Error(`attempt ${calls}`);
      },
      [1_000, 3_000],
      async (ms) => {
        waits.push(ms);
      },
      (error, index, willRetry) => failures.push([error.message, index, willRetry]),
    ),
    /attempt 3/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1_000, 3_000]);
  assert.deepEqual(failures, [
    ["attempt 1", 0, true],
    ["attempt 2", 1, true],
    ["attempt 3", 2, false],
  ]);
});

test("stops retrying as soon as the step succeeds", async () => {
  const waits = [];
  let calls = 0;
  const result = await retryWithDelays(
    async (index) => {
      calls += 1;
      if (index === 0) throw new Error("busy");
      return "saved";
    },
    [1_000, 3_000],
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(result, "saved");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1_000]);
});

test("names where a stop the stream made on its own came from", () => {
  assert.equal(stopSourceFromStream("notification"), "notification");
  assert.equal(stopSourceFromStream("alert"), "alert");
  assert.equal(stopSourceFromStream("paused_timeout"), "automatic");
  assert.equal(stopSourceFromStream("mic_error"), "mic_lost");
  assert.equal(stopSourceFromStream(undefined), "stream_ended");
  assert.equal(stopSourceFromStream("app"), "stream_ended");
});
