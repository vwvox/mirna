import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";

// Lessons on the phone: kept the way the Mac keeps them, the phone's own
// lesson choice, the clips it fetches and the reviews it sends back.
const db = new DatabaseSync(":memory:");
const documents = mkdtempSync(join(tmpdir(), "mirna-lessons-"));
const shared = {
  db,
  documents,
  storage: new Map(),
  calls: [],
  // What the stub Mac answers, by call.
  noteJob: () => ({
    status: { id: "x", state: "queued", job: { type: "set_lesson" } },
    working_host: null,
  }),
  downloadClip: (input) => {
    writeFileSync(new URL(input.file), `mp3:${input.clipId}`);
    return { size: 10, working_host: null };
  },
  sendReviews: (_connection, _session, reviews) => ({
    accepted: reviews.map((review) => JSON.parse(review).id),
    working_host: null,
  }),
};
globalThis.lessonsTest = shared;

const root = new URL("../", import.meta.url);
const stubs = {
  "@/db": `const {db} = globalThis.lessonsTest;
    export async function execute(sql, params = []) { return db.prepare(sql).all(...params); }
    export async function executeTransaction(statements) {
      db.exec('BEGIN');
      try {
        const result = statements.map(({sql, params}) => db.prepare(sql).run(...params).changes);
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    export function useLiveQuery({sql, params, mapRows}) {
      return {data: mapRows(db.prepare(sql).all(...params)), isLoading: false};
    }`,
  "@/lib/analytics": "export function captureAnalytics() {}",
  "@/lib/diagnostics":
    "export function logDiagnostic() {} export function logDiagnosticError() {}",
  "@/lib/ids":
    "export {randomUUID as id} from 'node:crypto'; export const nowIso = () => new Date().toISOString(); export const DEFAULT_USER_ID = 'user';",
  react: "export function useSyncExternalStore(_s, get) { return get(); }",
  "@react-native-async-storage/async-storage": `const {storage} = globalThis.lessonsTest;
    export default {
      async getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      async setItem(key, value) { storage.set(key, value); },
      async removeItem(key) { storage.delete(key); },
    };`,
  "expo-file-system": `import fs from 'node:fs';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const pathOf = (parts) => join(...parts.map((part) => typeof part === 'string' ? part : part.path));
    export class Directory {
      constructor(...parts) { this.path = pathOf(parts); }
      get exists() { return fs.existsSync(this.path); }
      get name() { return this.path.split('/').pop(); }
      list() {
        return fs.readdirSync(this.path).map((name) =>
          fs.statSync(join(this.path, name)).isDirectory() ? new Directory(this.path, name) : new File(this.path, name));
      }
      delete() { fs.rmSync(this.path, { recursive: true, force: true }); }
    }
    export class File {
      constructor(...parts) { this.path = pathOf(parts); }
      get exists() { return fs.existsSync(this.path); }
      get name() { return this.path.split('/').pop(); }
      get uri() { return pathToFileURL(this.path).href; }
      delete() { fs.rmSync(this.path, { force: true }); }
    }
    export const Paths = { document: new Directory(globalThis.lessonsTest.documents) };`,
  "./bridge": `const t = globalThis.lessonsTest;
    export class LinkError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export function noteJob(connection, recordingId, job) {
      t.calls.push(['noteJob', recordingId, job]);
      return Promise.resolve().then(() => t.noteJob(recordingId, job));
    }
    export function downloadClip(connection, input) {
      t.calls.push(['downloadClip', input.sessionId, input.clipId]);
      return Promise.resolve().then(() => t.downloadClip(input));
    }
    export function sendReviews(connection, sessionId, reviews) {
      t.calls.push(['sendReviews', sessionId, reviews.length]);
      return Promise.resolve().then(() => t.sendReviews(connection, sessionId, reviews));
    }
    export function refusalReason(error) {
      return /:\\s*([a-z_]+)\\s*$/.exec(error?.message ?? '')?.[1] ?? null;
    }
    export function isUnknownRequest() { return false; }`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (stubs[specifier])
      return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`${specifier.slice(2)}.ts`, root).href,
        shortCircuit: true,
      };
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier))
      return {
        url: new URL(`${specifier}.ts`, context.parentURL).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const migrations = new URL(
  "../../../../crates/db-app/migrations/",
  import.meta.url,
);
for (const name of readdirSync(migrations)
  .filter((file) => file.endsWith(".sql"))
  .sort()) {
  db.exec(readFileSync(new URL(name, migrations), "utf8"));
}
db.exec(
  `INSERT INTO app_settings (id, value_json) VALUES ('cloudsync_workspace_binding', '{"workspace_id":"workspace-a"}')`,
);
const { applyRemoteNote } = await import("./notes.ts");
const lessons = await import("./lessons.ts");
const schedule = await import("./schedule.ts");
const { LinkError } = await import("./bridge");
after(() => {
  hooks.deregister();
  rmSync(documents, { recursive: true, force: true });
});
beforeEach(() => {
  shared.calls.length = 0;
});

const connection = { identity: {}, mac: {} };
const tag = {
  course: "Mandarin",
  subject: "language",
  learning: "zh",
  explain_in: "en",
  subject_name: null,
};
const sheetDocument = {
  sheet: { version: 1, kind: "language", topic: "都", vocabulary: [] },
  generatedAt: "2026-11-25T10:00:00Z",
  model: "deepseek",
  sourceHash: "s1",
  clips: {},
};
const reviewDocument = {
  plan: { version: 1, mindset: "language", pieces: [] },
  generatedAt: "2026-11-25T10:01:00Z",
  model: null,
  sourceHash: "r1",
};
const lessonNote = (overrides = {}) => ({
  recording_id: "rec-lesson",
  session_id: "mac-lesson",
  title: "Lesson 14",
  summary_md: "- 都",
  transcripts: [],
  lesson: {
    settings_json: JSON.stringify({
      learning: "zh",
      explainIn: "en",
      subject: "language",
    }),
    course: "Mandarin",
    number: 14,
    sheet_json: JSON.stringify(sheetDocument),
    review_json: JSON.stringify(reviewDocument),
    clips: [
      { id: "c1000-3000-1", size: 10, sha256: "a".repeat(64) },
      { id: "c5000-7000-1", size: 10, sha256: "b".repeat(64) },
    ],
    reviews: [],
    ...overrides,
  },
});

function session(id) {
  return db
    .prepare(
      `SELECT kind,
        json_extract(metadata_json, '$.lesson') AS lesson,
        json_extract(metadata_json, '$.mac_lesson') AS mac_lesson,
        json_extract(metadata_json, '$.lesson_tag') AS tag
      FROM sessions WHERE id = ?`,
    )
    .get(id);
}

function liveDocuments(id) {
  return db
    .prepare(
      `SELECT id, kind FROM session_documents
        WHERE session_id = ? AND kind IN ('lesson_sheet', 'lesson_review')
          AND deleted_at IS NULL ORDER BY id`,
    )
    .all(id)
    .map((row) => row.id);
}

function addPhoneRecording(id, state) {
  db.exec(`
    INSERT INTO sessions (id, title, created_at, updated_at)
      VALUES ('${id}', '', '2026-11-25T09:00:00Z', '2026-11-25T09:00:00Z');
    INSERT INTO session_attachments (id, session_id, source_type, size_bytes, metadata_json)
      VALUES ('session-audio:${id}', '${id}', 'session_audio', 10,
        json_object('mac_link', json_object('state', '${state}')));
  `);
}

test("a lesson from the Mac is kept as the Mac keeps it, and undone with it", async () => {
  addPhoneRecording("rec-lesson", "done");
  assert.equal(await applyRemoteNote(lessonNote()), true);
  const kept = session("rec-lesson");
  assert.equal(kept.kind, "lesson");
  assert.deepEqual(JSON.parse(kept.lesson), {
    learning: "zh",
    explainIn: "en",
    subject: "language",
  });
  const mac = JSON.parse(kept.mac_lesson);
  assert.equal(mac.mac_session_id, "mac-lesson");
  assert.equal(mac.number, 14);
  assert.equal(mac.clips.length, 2);
  assert.deepEqual(liveDocuments("rec-lesson"), [
    "rec-lesson:lesson_review",
    "rec-lesson:lesson_sheet",
  ]);
  const sheet = db
    .prepare(
      "SELECT body FROM session_documents WHERE id = 'rec-lesson:lesson_sheet'",
    )
    .get();
  assert.equal(JSON.parse(sheet.body).sheet.topic, "都");

  // The same lesson again writes nothing.
  assert.equal(await applyRemoteNote(lessonNote()), false);

  // A review counted on the Mac updates the lesson, but isn't news.
  const updatedOnMac = () =>
    db
      .prepare(
        "SELECT json_extract(metadata_json, '$.mac_link.updated_on_mac_at') AS at FROM session_attachments WHERE id = 'session-audio:rec-lesson'",
      )
      .get().at;
  const before = updatedOnMac();
  await applyRemoteNote(
    lessonNote({
      reviews: [
        {
          id: "mac-run",
          ended_at: "2026-11-26T21:10:00Z",
          device: "mac",
          length: 5,
          right: 5,
          total: 6,
        },
      ],
    }),
  );
  assert.equal(JSON.parse(session("rec-lesson").mac_lesson).reviews.length, 1);
  assert.equal(updatedOnMac(), before);

  // Made a normal note on the Mac: the phone follows, and lets go of its choice.
  await lessons.saveLessonTag("rec-lesson", tag);
  const { at } = JSON.parse(session("rec-lesson").tag);
  await lessons.markLessonTagSent("rec-lesson", at);
  await applyRemoteNote({ ...lessonNote(), lesson: null });
  const undone = session("rec-lesson");
  assert.equal(undone.kind, "meeting");
  assert.equal(undone.lesson, null);
  assert.equal(undone.mac_lesson, null);
  assert.equal(undone.tag, null);
  assert.deepEqual(liveDocuments("rec-lesson"), []);
});

test("a lesson choice waits for the Mac until it has the recording", async () => {
  addPhoneRecording("rec-waiting", "waiting");
  addPhoneRecording("rec-on-mac", "transcribing");
  await lessons.saveLessonTag("rec-waiting", tag);
  await lessons.saveLessonTag("rec-on-mac", tag);
  assert.equal(session("rec-on-mac").kind, "lesson");
  assert.equal(JSON.parse(session("rec-on-mac").lesson).explainIn, "en");

  // Busy now: it goes at a later sync.
  shared.noteJob = () => {
    throw new LinkError("other", "the Mac answered 409: busy");
  };
  await lessons.sendPendingLessonTags(connection);
  assert.deepEqual(
    shared.calls.map((call) => call[1]),
    ["rec-on-mac"],
    "the recording still on the phone goes with its choice instead",
  );
  assert.equal(JSON.parse(session("rec-on-mac").tag).sent, false);

  shared.noteJob = () => ({
    status: {
      id: "rec-on-mac",
      state: "queued",
      session_id: "mac-2",
      job: { type: "set_lesson" },
    },
    working_host: null,
  });
  await lessons.sendPendingLessonTags(connection);
  assert.equal(JSON.parse(session("rec-on-mac").tag).sent, true);
  const link = db
    .prepare(
      "SELECT json_extract(metadata_json, '$.mac_link') AS link FROM session_attachments WHERE id = 'session-audio:rec-on-mac'",
    )
    .get();
  assert.equal(JSON.parse(link.link).job, "set_lesson");

  // Sent once: not again.
  shared.calls.length = 0;
  await lessons.sendPendingLessonTags(connection);
  assert.deepEqual(shared.calls, []);
});

test("a choice made while the recording went still reaches the Mac", async () => {
  addPhoneRecording("rec-race", "sending");
  const first = await lessons.saveLessonTag("rec-race", tag);
  // The upload read the first choice; a second one came before it finished.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await lessons.saveLessonTag("rec-race", { ...tag, course: "Mandarin 2" });
  await lessons.markLessonTagSent("rec-race", first.at);
  const state = JSON.parse(session("rec-race").tag);
  assert.equal(state.sent, false);
  assert.equal(state.lesson.course, "Mandarin 2");
});

test("saying a note that never was a lesson is a note needs nothing from the Mac", async () => {
  addPhoneRecording("rec-note", "done");
  const state = await lessons.saveLessonTag("rec-note", null);
  assert.equal(state.sent, true);
  assert.equal(session("rec-note").kind, "meeting");
});

test("clips of the newest lessons are fetched once, and old ones cleared", async () => {
  await applyRemoteNote(lessonNote());
  const dir = join(documents, "sessions", "rec-lesson", "clips");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "c1000-3000-1.mp3"), "already here");
  writeFileSync(join(dir, "c9-9-1.mp3"), "no plan plays it");
  await lessons.downloadLessonClips(connection);
  assert.deepEqual(
    shared.calls,
    [["downloadClip", "mac-lesson", "c5000-7000-1"]],
    "asks the Mac by its own id, only for the missing clip",
  );
  assert.deepEqual(readdirSync(dir).sort(), [
    "c1000-3000-1.mp3",
    "c5000-7000-1.mp3",
  ]);
  assert.ok(lessons.clipUri("rec-lesson", "c5000-7000-1"));
  assert.equal(lessons.clipUri("rec-lesson", "c9-9-1"), null);

  shared.calls.length = 0;
  await lessons.downloadLessonClips(connection);
  assert.deepEqual(shared.calls, []);
});

test("reviews played here go to the Mac once, and stay until it counted them", async () => {
  const run = {
    id: "run-1",
    startedAt: "2026-11-27T08:07:00Z",
    endedAt: "2026-11-27T08:12:00Z",
    length: 5,
    device: "phone",
    planHash: "r1",
    results: [
      {
        pieceId: "p1",
        kind: "quick_fire",
        outcome: "knew",
        cardId: null,
        markId: null,
      },
    ],
  };
  await lessons.queuePhoneReview({
    sessionId: "rec-lesson",
    macSessionId: "mac-lesson",
    run,
  });
  // Saved twice (a double tap) is one review.
  await lessons.queuePhoneReview({
    sessionId: "rec-lesson",
    macSessionId: "mac-lesson",
    run,
  });
  assert.equal((await schedule.loadReviewOutbox()).length, 1);

  await lessons.sendQueuedReviews(connection);
  assert.deepEqual(shared.calls, [["sendReviews", "mac-lesson", 1]]);
  const [sent] = await schedule.loadReviewOutbox();
  assert.ok(sent.sent_at, "kept as sent until the Mac counts it");

  shared.calls.length = 0;
  await lessons.sendQueuedReviews(connection);
  assert.deepEqual(shared.calls, [], "not sent again");

  // The Mac's next note lists it as counted: the phone lets it go.
  await applyRemoteNote(
    lessonNote({
      reviews: [
        {
          id: "run-1",
          ended_at: run.endedAt,
          device: "phone",
          length: 5,
          right: 1,
          total: 1,
        },
      ],
    }),
  );
  await lessons.sendQueuedReviews(connection);
  assert.deepEqual(await schedule.loadReviewOutbox(), []);
});

test("reviews of a note the Mac no longer has are let go", async () => {
  await lessons.queuePhoneReview({
    sessionId: "gone",
    macSessionId: "mac-gone",
    run: {
      id: "run-2",
      startedAt: "2026-11-27T08:00:00Z",
      endedAt: "2026-11-27T08:05:00Z",
      length: 5,
      device: "phone",
      planHash: "x",
      results: [],
    },
  });
  shared.sendReviews = () => {
    throw new LinkError("other", "the Mac answered 404: unknown_note");
  };
  await lessons.sendQueuedReviews(connection);
  assert.deepEqual(await schedule.loadReviewOutbox(), []);
  assert.equal(existsSync(documents), true);
});
