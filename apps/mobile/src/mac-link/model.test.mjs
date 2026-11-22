import assert from "node:assert/strict";
import test from "node:test";

import {
  describeMacLink,
  parseMacLink,
  proseMirrorToMarkdown,
  wavDurationMs,
} from "./model.ts";

test("reads the stored status, defaulting to waiting", () => {
  assert.deepEqual(parseMacLink(null), { state: "waiting" });
  assert.deepEqual(parseMacLink("not json"), { state: "waiting" });
  assert.equal(parseMacLink('{"state":"on_mac"}').state, "on_mac");
});

test("describes each step plainly", () => {
  assert.equal(
    describeMacLink({ state: "waiting" }, "Studio"),
    "Waiting for Studio",
  );
  assert.equal(
    describeMacLink({ state: "sending", sent_bytes: 50, total_bytes: 200 }),
    "Sending to your Mac · 25%",
  );
  // Never shows 100% before the Mac confirms the whole file.
  assert.equal(
    describeMacLink({ state: "sending", sent_bytes: 200, total_bytes: 200 }),
    "Sending to your Mac · 99%",
  );
  assert.equal(
    describeMacLink({
      state: "failed",
      error: "Transcription was stopped on the Mac.",
    }),
    "Transcription was stopped on the Mac.",
  );
  assert.equal(
    describeMacLink({ state: "done" }, "Studio"),
    "Transcribed on Studio",
  );
});

test("estimates the length of the app's own WAV recordings", () => {
  assert.equal(wavDurationMs("audio.wav", 44 + 32_000 * 90), 90_000);
  assert.equal(wavDurationMs("audio.m4a", 1_000_000), null);
});

test("turns the note editor's document into Markdown for the Mac", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Agenda" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Budget first." }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Ana" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Rui" }] },
            ],
          },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Send deck" }],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(
    proseMirrorToMarkdown(doc),
    "## Agenda\n\nBudget first.\n\n- Ana\n- Rui\n\n- [x] Send deck",
  );
});
