import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanDetail,
  describeEntry,
  diagnosticLine,
  errorDetail,
  exportText,
  keepRecentLines,
  parseDiagnostics,
} from "./diagnostics-model.ts";

test("writes one JSON line per event, without empty details", () => {
  const line = diagnosticLine(
    "recording_saved",
    "info",
    { minutes: 62, native: true, skipped: undefined },
    new Date("2026-11-24T15:44:46Z"),
  );
  assert.equal(
    line,
    '{"at":"2026-11-24T15:44:46.000Z","level":"info","event":"recording_saved","detail":{"minutes":62,"native":true}}\n',
  );
  assert.equal(
    diagnosticLine("app_opened", "info", {}, new Date(0)),
    '{"at":"1970-01-01T00:00:00.000Z","level":"info","event":"app_opened"}\n',
  );
});

test("keeps lines short and on one line", () => {
  const detail = cleanDetail({ error: `first\nsecond ${"x".repeat(400)}` });
  assert.ok(!detail.error.includes("\n"));
  assert.ok(detail.error.length <= 301);
  assert.equal(cleanDetail({ bad: Number.NaN }).bad, null);
});

test("keeps an error's kind, message and code", () => {
  const error = Object.assign(new Error("disk full"), { code: "io" });
  assert.deepEqual(errorDetail(error), {
    error: "Error: disk full",
    code: "io",
  });
  assert.deepEqual(errorDetail("plain"), { error: "plain" });
  assert.deepEqual(errorDetail(undefined), {});
});

test("trims to the most recent lines and skips a line cut short", () => {
  const text = "a\nb\nc\nd\n";
  assert.equal(keepRecentLines(text, 2), "c\nd\n");
  const log =
    diagnosticLine("one", "info", undefined, new Date(0)) +
    '{"at":"1970-01-01T00:00:00.000Z","lev';
  const entries = parseDiagnostics(log);
  assert.equal(entries.length, 1);
  assert.equal(
    describeEntry({ ...entries[0], level: "error", detail: { code: "io" } }),
    "one [error]  code=io",
  );
});

test("an export says where it came from", () => {
  assert.equal(
    exportText({ header: { app: "Mirna", version: "0.1.11" }, log: "x\n" }),
    "# app: Mirna\n# version: 0.1.11\n#\nx\n",
  );
});
