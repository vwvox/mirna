import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

const db = new DatabaseSync(":memory:");
globalThis.macNotesTest = { db };
const root = new URL("../", import.meta.url);
const stubs = {
  "@/db": `const {db} = globalThis.macNotesTest;
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
  "@/lib/ids":
    "export {randomUUID as id} from 'node:crypto'; export const nowIso = () => new Date().toISOString(); export const DEFAULT_USER_ID = 'user';",
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
// The app's database always has a workspace binding (made when it opens).
db.exec(
  `INSERT INTO app_settings (id, value_json) VALUES ('cloudsync_workspace_binding', '{"workspace_id":"workspace-a"}')`,
);
const { applyRemoteNote } = await import("./notes.ts");
after(() => hooks.deregister());

const words = (text) =>
  JSON.stringify(
    text.split(" ").map((word, index) => ({
      text: word,
      start_ms: index * 400,
      end_ms: index * 400 + 350,
      channel: 0,
      speaker_index: 0,
    })),
  );

test("a note recorded on the Mac arrives as a text-only note", async () => {
  const changed = await applyRemoteNote({
    recording_id: null,
    session_id: "mac-meeting",
    title: "Zoom with the team",
    summary_md: "- Shipping next week",
    created_at: "2026-11-22T15:00:00Z",
    transcripts: [
      {
        id: "mac-meeting-t1",
        started_at_ms: 1_795_000_000_000,
        ended_at_ms: 1_795_000_600_000,
        memo: "",
        words_json: words("Hello from the Mac"),
        speaker_hints_json: "[]",
      },
    ],
  });
  assert.equal(changed, true);
  const [session] = db
    .prepare(
      "SELECT title, created_at, json_extract(metadata_json, '$.mac_note.session_id') AS mac FROM sessions WHERE id = 'mac-mac-meeting'",
    )
    .all();
  assert.equal(session.title, "Zoom with the team");
  assert.equal(session.mac, "mac-meeting");
  assert.match(session.created_at, /^2026-11-22T15:00/);
  const [summary] = db
    .prepare(
      "SELECT body FROM session_documents WHERE session_id = 'mac-mac-meeting' AND kind = 'summary'",
    )
    .all();
  assert.equal(summary.body, "- Shipping next week");
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM transcripts WHERE session_id = 'mac-mac-meeting' AND deleted_at IS NULL",
      )
      .get().n,
    1,
  );

  // The same text again changes nothing; deleting it on the phone keeps it deleted.
  db.prepare(
    "UPDATE sessions SET deleted_at = '2026-11-23T00:00:00Z' WHERE id = 'mac-mac-meeting'",
  ).run();
  assert.equal(
    await applyRemoteNote({
      recording_id: null,
      session_id: "mac-meeting",
      title: "Zoom with the team",
      summary_md: "- Changed",
      transcripts: [],
    }),
    false,
  );
});

test("a phone recording's note picks up a recording added on the Mac", async () => {
  db.exec(`
    INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('rec-1', 'Standup', '2026-11-22T09:30:00Z', '2026-11-22T09:30:00Z');
    INSERT INTO session_attachments (id, session_id, source_type, size_bytes, metadata_json)
      VALUES ('session-audio:rec-1', 'rec-1', 'session_audio', 10, json_object('capture_started_at_ms', 1795000000000, 'mac_link', json_object('state', 'done')));
  `);
  const phoneTranscript = {
    id: "t-phone",
    started_at_ms: 1_795_000_001_000,
    ended_at_ms: 1_795_000_301_000,
    memo: "",
    words_json: words("Phone part"),
    speaker_hints_json: "[]",
  };
  const first = {
    recording_id: "rec-1",
    session_id: "mac-session-1",
    title: "Standup with Ana",
    summary_md: "- Budget approved",
    transcripts: [phoneTranscript],
  };
  await applyRemoteNote(first);
  const status = () =>
    JSON.parse(
      db
        .prepare(
          "SELECT json_extract(metadata_json, '$.mac_link') AS link FROM session_attachments WHERE id = 'session-audio:rec-1'",
        )
        .get().link,
    );
  assert.equal(status().updated_on_mac_at, null);
  assert.deepEqual(status().mac_recordings, []);
  // A title typed on the phone wins.
  assert.equal(
    db.prepare("SELECT title FROM sessions WHERE id = 'rec-1'").get().title,
    "Standup",
  );

  await applyRemoteNote({
    ...first,
    summary_md: "- Budget approved\n- Venue booked",
    transcripts: [
      phoneTranscript,
      {
        ...phoneTranscript,
        id: "t-mac",
        started_at_ms: 1_795_003_600_000,
        ended_at_ms: 1_795_003_720_000,
      },
    ],
  });
  assert.ok(status().updated_on_mac_at);
  assert.deepEqual(status().mac_recordings, [
    { id: "t-mac", duration_ms: 120_000 },
  ]);
  assert.equal(
    db
      .prepare(
        "SELECT body FROM session_documents WHERE session_id = 'rec-1' AND kind = 'summary'",
      )
      .get().body,
    "- Budget approved\n- Venue booked",
  );
});
