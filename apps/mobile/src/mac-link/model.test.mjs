import assert from "node:assert/strict";
import test from "node:test";

import {
  backoffAfterFailure,
  describeMacLink,
  hashText,
  hotspotCandidates,
  isBackingOff,
  isHomeNetwork,
  keepSyncedFields,
  macOnlyRecordings,
  needsMacContact,
  parseMacLink,
  proseMirrorToMarkdown,
  rememberNetwork,
  strongerTrigger,
  wavDurationMs,
} from "./model.ts";

test("only recordings that still need the Mac keep the phone checking", () => {
  assert.equal(needsMacContact({ state: "waiting" }, "auto"), true);
  assert.equal(needsMacContact({ state: "waiting" }, "manual"), false);
  assert.equal(needsMacContact({ state: "sending" }, "manual"), false);
  assert.equal(needsMacContact({ state: "transcribing" }, "manual"), true);
  assert.equal(needsMacContact({ state: "done" }, "auto"), false);
  assert.equal(needsMacContact({ state: "failed" }, "auto"), false);
});

test("a tap beats an automatic check", () => {
  assert.equal(strongerTrigger("background", "user"), "user");
  assert.equal(strongerTrigger("open", "interval"), "open");
});

test("waits longer after each failure on the same Wi-Fi", () => {
  const now = 1_000_000;
  const first = backoffAfterFailure(null, "home", now);
  assert.equal(first.next_at_ms, now + 15 * 60_000);
  const second = backoffAfterFailure(first, "home", now);
  assert.equal(second.next_at_ms, now + 30 * 60_000);
  const third = backoffAfterFailure(second, "home", now);
  const fourth = backoffAfterFailure(third, "home", now);
  assert.equal(fourth.next_at_ms, now + 60 * 60_000);
  assert.equal(isBackingOff(fourth, "home", now + 1), true);
  // Joining another Wi-Fi tries again straight away.
  assert.equal(isBackingOff(fourth, "cafe", now + 1), false);
  assert.equal(backoffAfterFailure(fourth, "cafe", now).failures, 1);
});

test("remembers where the Mac answered", () => {
  assert.deepEqual(rememberNetwork(["a", "b"], "b"), ["b", "a"]);
  assert.equal(rememberNetwork(["1", "2", "3"], "4", 3).length, 3);
  assert.equal(isHomeNetwork([], "anywhere"), true);
  assert.equal(isHomeNetwork(["home"], "cafe"), false);
  assert.equal(isHomeNetwork(["home"], null), false);
});

test("tells the phone's own recording from ones added on the Mac", () => {
  const phoneStart = 1_795_000_000_000;
  const transcripts = [
    { id: "later", started_at_ms: phoneStart + 3_600_000, ended_at_ms: phoneStart + 3_720_000 },
    { id: "phone", started_at_ms: phoneStart + 2_000, ended_at_ms: phoneStart + 600_000 },
  ].map((t) => ({ ...t, memo: "", words_json: "[]", speaker_hints_json: "[]" }));
  assert.deepEqual(macOnlyRecordings(transcripts, phoneStart), [
    { id: "later", duration_ms: 120_000 },
  ]);
  // Notes made before the Mac dated phone recordings: the earliest is the phone's.
  assert.deepEqual(
    macOnlyRecordings(transcripts, null).map((r) => r.id),
    ["later"],
  );
  assert.deepEqual(macOnlyRecordings([], phoneStart), []);
});

test("keeps what came back from the Mac through progress updates", () => {
  const kept = keepSyncedFields({
    state: "done",
    sent_bytes: 10,
    synced: { title: "A" },
    mac_recordings: [],
  });
  assert.deepEqual(kept, { synced: { title: "A" }, mac_recordings: [] });
  assert.notEqual(hashText("summary one"), hashText("summary two"));
  assert.equal(hashText("same"), hashText("same"));
});

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

test("looks for the Mac on every other address of the phone's hotspot", () => {
  const candidates = hotspotCandidates([
    { address: "10.181.42.1", prefix_length: 24 },
  ]);
  assert.equal(candidates.length, 253);
  assert.equal(candidates[0], "10.181.42.2");
  assert.equal(candidates.at(-1), "10.181.42.254");
  assert.ok(!candidates.includes("10.181.42.1"));
  assert.ok(!candidates.includes("10.181.42.0"));
  assert.ok(!candidates.includes("10.181.42.255"));

  // A wider subnet is narrowed to the phone's /24; a small one stays small.
  const wide = hotspotCandidates([{ address: "192.168.200.7", prefix_length: 16 }]);
  assert.equal(wide.length, 253);
  assert.ok(wide.every((address) => address.startsWith("192.168.200.")));
  assert.deepEqual(
    hotspotCandidates([{ address: "172.20.10.1", prefix_length: 28 }]),
    ["172.20.10.2", "172.20.10.3", "172.20.10.4", "172.20.10.5", "172.20.10.6",
     "172.20.10.7", "172.20.10.8", "172.20.10.9", "172.20.10.10", "172.20.10.11",
     "172.20.10.12", "172.20.10.13", "172.20.10.14"],
  );

  // Two hotspots (Wi-Fi and USB), capped; nonsense addresses are skipped.
  const both = hotspotCandidates(
    [
      { address: "not-an-address", prefix_length: 24 },
      { address: "192.168.43.1", prefix_length: 24 },
      { address: "192.168.42.129", prefix_length: 24 },
    ],
    300,
  );
  assert.equal(both.length, 300);
  assert.equal(both[253], "192.168.42.1");
});
