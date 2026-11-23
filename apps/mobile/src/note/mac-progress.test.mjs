import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClock,
  formatLength,
  formatSize,
  isOnItsWay,
  noteLengthMs,
  progressSteps,
  recentMacUpdate,
  retryProblem,
  sendPercent,
  summarySnippet,
} from "./mac-progress.ts";

const DAY = 24 * 60 * 60_000;

test("a change on the Mac is pointed out for two days", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const status = (at) => ({ state: "done", updated_on_mac_at: at });
  assert.ok(recentMacUpdate(status(new Date(now - DAY).toISOString()), now));
  assert.equal(
    recentMacUpdate(status(new Date(now - 3 * DAY).toISOString()), now),
    null,
  );
  assert.equal(recentMacUpdate(status(null), now), null);
  assert.equal(recentMacUpdate(status("not a date"), now), null);
  assert.equal(recentMacUpdate(null, now), null);
});

test("sending never shows 100% before the Mac has it all", () => {
  assert.equal(
    sendPercent({ state: "sending", sent_bytes: 42, total_bytes: 100 }),
    42,
  );
  assert.equal(
    sendPercent({ state: "sending", sent_bytes: 100, total_bytes: 100 }),
    99,
  );
  assert.equal(sendPercent({ state: "sending" }), 0);
});

test("lengths, clock times and sizes read plainly", () => {
  assert.equal(formatLength(40_000), "40 s");
  assert.equal(formatLength(6 * 60_000), "6 min");
  assert.equal(formatLength(65 * 60_000), "1 h 5 min");
  assert.equal(formatLength(120 * 60_000), "2 h");
  assert.equal(formatClock(32 * 60 + 10), "32:10");
  assert.equal(formatClock(3723), "1:02:03");
  assert.equal(formatSize(31 * 1024 * 1024), "31 MB");
  assert.equal(formatSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(formatSize(300 * 1024), "300 KB");
});

test("a note's length adds the recordings made on the Mac", () => {
  // 16 kHz mono 16-bit WAV: 32,000 bytes a second, plus the 44-byte header.
  const sixMinutes = 44 + 6 * 60 * 32_000;
  assert.equal(
    noteLengthMs({ filename: "audio.wav", sizeBytes: sixMinutes }),
    6 * 60_000,
  );
  assert.equal(
    noteLengthMs({
      filename: "audio.wav",
      sizeBytes: sixMinutes,
      macRecordings: [
        { id: "b", duration_ms: 60_000 },
        { id: "c", duration_ms: null },
      ],
    }),
    7 * 60_000,
  );
  assert.equal(
    noteLengthMs({ filename: "call.m4a", sizeBytes: 1000, fallbackMs: 90_000 }),
    90_000,
  );
  assert.equal(noteLengthMs({ filename: "call.m4a", sizeBytes: 1000 }), null);
});

test("the home snippet is the summary's points without headings or markup", () => {
  assert.equal(
    summarySnippet(
      "## Decisions\n\n- Budget approved for the spring workshop\n- Venue: **library hall**, booked for 14 March.\n\n## Next steps\n\n1. Ana: confirm catering",
      "markdown",
    ),
    "Budget approved for the spring workshop. Venue: library hall, booked for 14 March. Ana: confirm catering.",
  );
  assert.equal(summarySnippet("", "markdown"), null);
  assert.equal(summarySnippet("## Only a heading", "markdown"), null);
  const doc = JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Order compost" }] },
    ],
  });
  assert.equal(summarySnippet(doc, "prosemirror_json"), "Order compost.");
});

test("the progress card follows the recording from the phone to a summary", () => {
  const saved = { lengthMs: 32 * 60_000, sizeBytes: 31 * 1024 * 1024 };
  const states = (status) =>
    progressSteps(status, "MacBook Air", saved).map((step) => step.state);

  const waiting = progressSteps({ state: "waiting" }, "MacBook Air", saved);
  assert.equal(waiting[0].detail, "32 min · 31 MB");
  assert.equal(waiting[1].label, "Waiting for your Mac");
  assert.deepEqual(states({ state: "waiting" }), [
    "done",
    "waiting",
    "todo",
    "todo",
  ]);

  const sending = progressSteps(
    { state: "sending", sent_bytes: 42, total_bytes: 100 },
    "MacBook Air",
    saved,
  );
  assert.equal(sending[1].label, "Sending to MacBook Air");
  assert.equal(sending[1].percent, 42);
  assert.match(sending[1].detail, /^42%/);

  const queued = progressSteps({ state: "on_mac" }, "MacBook Air", saved);
  assert.equal(queued[2].label, "Waiting its turn on MacBook Air");
  assert.deepEqual(states({ state: "on_mac" }), [
    "done",
    "done",
    "active",
    "todo",
  ]);

  assert.equal(
    progressSteps({ state: "transcribing" }, "MacBook Air", saved)[2].label,
    "Transcribing on MacBook Air",
  );
  const summarizing = progressSteps(
    { state: "summarizing" },
    "MacBook Air",
    saved,
  );
  assert.equal(summarizing[3].label, "Writing the summary");
  assert.deepEqual(states({ state: "summarizing" }), [
    "done",
    "done",
    "done",
    "active",
  ]);

  assert.match(
    progressSteps({ state: "waiting" }, "MacBook Air", saved, "manual")[1]
      .detail,
    /Send now/,
  );
});

test("only recordings still on their way get the progress card", () => {
  assert.equal(isOnItsWay({ state: "waiting" }), true);
  assert.equal(isOnItsWay({ state: "summarizing" }), true);
  assert.equal(isOnItsWay({ state: "done" }), false);
  assert.equal(isOnItsWay({ state: "failed" }), false);
  assert.equal(isOnItsWay(null), false);
});

test("a Try again that didn't reach the Mac says why", () => {
  assert.equal(retryProblem("done", "MacBook Air"), null);
  assert.match(
    retryProblem("not_on_wifi", "MacBook Air").description,
    /same Wi-Fi/,
  );
  assert.match(
    retryProblem("mac_unreachable", "MacBook Air").title,
    /MacBook Air/,
  );
  assert.match(
    retryProblem("unpaired_by_mac", "MacBook Air").description,
    /Pair again/,
  );
});
