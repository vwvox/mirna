import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

const db = new DatabaseSync(":memory:");
globalThis.audioCatalogPersistence = db;
const mocks = {
  "@/db": `export function useLiveQuery() {} export async function executeTransaction(statements) {
    const db = globalThis.audioCatalogPersistence; db.exec('BEGIN');
    try { const result = statements.map(({sql, params}) => db.prepare(sql).run(...params).changes); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }`,
  "expo-file-system": `export const Paths = {document: '/fixture'}; export const FileMode = {ReadOnly: 0}; export class File {}`,
  "./file-sha256": `export async function hashFileSha256() { return {sha256: 'a'.repeat(64), sizeBytes: 44}; }`,
  "@/attachment-sync/upload-runner": `export function requestMobileAttachmentUploads() {}`,
  "@/attachment-sync/upload-store": `export function requeueMobileAttachmentUpload() {}`,
  "@/lib/ids": `export {randomUUID as id} from 'node:crypto'; export const nowIso = () => new Date().toISOString();`,
  "@/lib/diagnostics": `export function logDiagnostic() {} export function logDiagnosticError() {}`,
  "react-native": `export const AppState = { currentState: 'background' };`,
  // Native checksums; the size changes as a trimmed file would.
  "@/mac-link/bridge": `export async function fileSha256() { return {sha256: globalThis.nativeSha ?? 'a'.repeat(64), size_bytes: globalThis.nativeSize ?? 44}; }`,
  "@/mac-link/status": `export async function loadMacLinkStatus(sessionId) {
    const row = globalThis.audioCatalogPersistence.prepare(
      "SELECT json_extract(metadata_json, '$.mac_link') AS mac_link FROM session_attachments WHERE id = ?",
    ).get('session-audio:' + sessionId);
    return row?.mac_link ? JSON.parse(row.mac_link) : { state: 'waiting' };
  }`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (mocks[specifier])
      return {
        url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`,
        shortCircuit: true,
      };
    if (specifier === "./audio-catalog-model")
      return {
        url: new URL("./audio-catalog-model.ts", import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === "@/mac-link/model")
      return {
        url: new URL("../mac-link/model.ts", import.meta.url).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const {
  recordSessionCaptureStart,
  catalogSessionAudio,
  refreshSessionAudioFile,
} = await import("./audio-catalog.ts");
for (const name of [
  "20260710223922_canonical_data_model.sql",
  "20260717140000_attachment_local_state.sql",
  "20260717150000_attachment_transfer_jobs.sql",
  "20260717170000_attachment_cloud_sync_intent.sql",
]) {
  db.exec(
    readFileSync(
      new URL(`../../../../crates/db-app/migrations/${name}`, import.meta.url),
      "utf8",
    ),
  );
}
after(() => {
  hooks.deregister();
  db.close();
  delete globalThis.audioCatalogPersistence;
});

test("recording recovery preserves the durable capture time while imports ignore stale recording metadata", async () => {
  db.exec("INSERT INTO sessions (id) VALUES ('recorded'), ('imported')");
  for (const sessionId of ["recorded", "imported"])
    await recordSessionCaptureStart(sessionId);
  const capture = db
    .prepare(
      "SELECT json_extract(metadata_json, '$.mobile_capture_started_at_ms') AS time FROM sessions WHERE id = 'recorded'",
    )
    .get().time;
  assert.ok(Number.isFinite(capture));
  await catalogSessionAudio("recorded", {
    source: "recording",
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  await catalogSessionAudio("imported", {
    source: "import",
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  const metadata = (sessionId) =>
    JSON.parse(
      db
        .prepare(
          "SELECT metadata_json FROM session_attachments WHERE session_id = ?",
        )
        .get(sessionId).metadata_json,
    );
  assert.equal(metadata("recorded").capture_started_at_ms, capture);
  assert.equal(metadata("imported").capture_started_at_ms, null);
  // Recovery re-catalogs from durable session state without starting a new capture.
  await catalogSessionAudio("recorded", {
    source: "recording",
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  assert.equal(metadata("recorded").capture_started_at_ms, capture);
});

test("a trimmed recording gets its new size and checksum, and keeps its way to the Mac", async () => {
  db.exec("INSERT INTO sessions (id) VALUES ('trimmed')");
  await recordSessionCaptureStart("trimmed");
  await catalogSessionAudio("trimmed", {
    source: "recording",
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  db.exec(`UPDATE session_attachments SET metadata_json = json_set(metadata_json,
    '$.mac_link', json('{"state":"done","mac_session_id":"mac-1"}'),
    '$.transcript_status', 'complete') WHERE session_id = 'trimmed'`);
  globalThis.nativeSha = "b".repeat(64);
  globalThis.nativeSize = 20_044;
  try {
    assert.deepEqual(await refreshSessionAudioFile("trimmed", "audio.wav"), {
      sizeBytes: 20_044,
    });
  } finally {
    delete globalThis.nativeSha;
    delete globalThis.nativeSize;
  }
  const row = db
    .prepare(
      "SELECT size_bytes, sha256, metadata_json FROM session_attachments WHERE session_id = 'trimmed'",
    )
    .get();
  assert.equal(row.size_bytes, 20_044);
  assert.equal(row.sha256, "b".repeat(64));
  const metadata = JSON.parse(row.metadata_json);
  assert.equal(metadata.mac_link.state, "done");
  assert.equal(metadata.mac_link.mac_session_id, "mac-1");
  assert.equal(metadata.transcript_status, "complete");
});

test("recording more keeps the note linked to the Mac's and sends it again", async () => {
  db.exec("INSERT INTO sessions (id) VALUES ('more')");
  await recordSessionCaptureStart("more");
  await catalogSessionAudio("more", {
    source: "recording",
    filename: "audio.wav",
    contentType: "audio/wav",
  });
  const capture = db
    .prepare(
      "SELECT json_extract(metadata_json, '$.capture_started_at_ms') AS time FROM session_attachments WHERE session_id = 'more'",
    )
    .get().time;
  db.exec(`UPDATE session_attachments SET metadata_json = json_set(metadata_json,
    '$.mac_link', json('{"state":"done","mac_session_id":"mac-1","synced":{"title":"Standup"}}'),
    '$.transcript_status', 'complete') WHERE session_id = 'more'`);

  globalThis.nativeSha = "c".repeat(64);
  globalThis.nativeSize = 64_044;
  try {
    await catalogSessionAudio("more", {
      source: "recording",
      filename: "audio.wav",
      contentType: "audio/wav",
      resendToMac: true,
    });
  } finally {
    delete globalThis.nativeSha;
    delete globalThis.nativeSize;
  }
  const row = db
    .prepare(
      "SELECT size_bytes, sha256, metadata_json FROM session_attachments WHERE session_id = 'more'",
    )
    .get();
  assert.equal(row.size_bytes, 64_044);
  assert.equal(row.sha256, "c".repeat(64));
  const metadata = JSON.parse(row.metadata_json);
  assert.equal(metadata.mac_link.state, "waiting");
  assert.equal(metadata.mac_link.resend, true);
  assert.equal(metadata.mac_link.mac_session_id, "mac-1");
  assert.deepEqual(metadata.mac_link.synced, { title: "Standup" });
  // Still dated when the first recording started.
  assert.equal(metadata.capture_started_at_ms, capture);
  assert.equal(metadata.transcript_status, "processing");
});
