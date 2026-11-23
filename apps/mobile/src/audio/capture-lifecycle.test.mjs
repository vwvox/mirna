import assert from "node:assert/strict";
import test from "node:test";

import {
  beginMobileCapture,
  endMobileCapture,
  getMobileCaptureActive,
  isCapturingSession,
  isRecordingNow,
  setSessionRecording,
  stopMobileCapture,
  subscribeRecordingNow,
} from "./capture-lifecycle.ts";

test("is recording while any session records or is paused", () => {
  const changes = [];
  const unsubscribe = subscribeRecordingNow(() =>
    changes.push(isRecordingNow()),
  );
  assert.equal(isRecordingNow(), false);

  setSessionRecording("session-1", true);
  setSessionRecording("session-2", true);
  assert.equal(isRecordingNow(), true);

  // Pausing keeps the session recording; only saving or failing ends it.
  setSessionRecording("session-1", true);
  setSessionRecording("session-1", false);
  assert.equal(isRecordingNow(), true);
  setSessionRecording("session-2", false);
  assert.equal(isRecordingNow(), false);

  unsubscribe();
  setSessionRecording("session-3", true);
  setSessionRecording("session-3", false);
  assert.deepEqual(changes, [true, false]);
});

test("knows which session is still capturing", () => {
  beginMobileCapture("session-a");
  assert.equal(isCapturingSession("session-a"), true);
  assert.equal(isCapturingSession("session-b"), false);
  endMobileCapture("session-a");
  assert.equal(isCapturingSession("session-a"), false);
});

test("keeps the mobile gate open until every active capture is settled", () => {
  beginMobileCapture("session-1");
  beginMobileCapture("session-2");
  assert.equal(getMobileCaptureActive(), true);

  endMobileCapture("session-1");
  assert.equal(getMobileCaptureActive(), true);

  endMobileCapture("session-2");
  assert.equal(getMobileCaptureActive(), false);
});

test("stops the active capture through the registered handler", async () => {
  const stopped = [];
  beginMobileCapture("session-1", async () => {
    stopped.push("session-1");
    endMobileCapture("session-1");
  });

  assert.equal(await stopMobileCapture(), true);
  assert.deepEqual(stopped, ["session-1"]);
  assert.equal(getMobileCaptureActive(), false);
  assert.equal(await stopMobileCapture(), false);
});

test("waits for a starting capture to register its stop handler", async () => {
  beginMobileCapture("session-1");
  const stopRequested = stopMobileCapture();

  beginMobileCapture("session-1", async () => {
    endMobileCapture("session-1");
  });

  assert.equal(await stopRequested, true);
  assert.equal(getMobileCaptureActive(), false);
});
