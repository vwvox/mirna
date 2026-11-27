import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const files = (globalThis.wavWriterFiles = new Map());
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/audio/pcm-wav")
      return {
        url: new URL("./pcm-wav.ts", import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === "expo-file-system")
      return { url: "test:wav-files", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== "test:wav-files") return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: `
      export const Paths = { document: "/test" };
      export const FileMode = { ReadWrite: "rw" };
      export class Directory { constructor(...parts) { this.path = parts.join("/"); } create() {} }
      export class File {
        exists = false;
        bytes = new Uint8Array(0);
        constructor(directory, filename) {
          const path = directory.path + "/" + filename;
          // The same path is the same file, as on disk.
          const existing = globalThis.wavWriterFiles.get(path);
          if (existing) return existing;
          this.path = path;
          globalThis.wavWriterFiles.set(this.path, this);
        }
        get size() { return this.bytes.length; }
        create() { this.exists = true; }
        delete() { this.exists = false; this.bytes = new Uint8Array(0); }
        open() {
          const file = this;
          file.openHandles = (file.openHandles ?? 0) + 1;
          return { offset: 0, writeBytes(bytes) {
            if (file.failWrite) throw Error("Disk write failed");
            const result = new Uint8Array(Math.max(file.bytes.length, this.offset + bytes.length));
            result.set(file.bytes); result.set(bytes, this.offset); file.bytes = result; this.offset += bytes.length;
          }, readBytes(length) {
            const bytes = file.bytes.slice(this.offset, this.offset + length);
            this.offset += bytes.length;
            return bytes;
          }, close() { file.openHandles -= 1; } };
        }
      }
    `,
    };
  },
});
const { SessionWavWriter, continueInNextPart } =
  await import("./session-wav-writer.ts");

test("elapsed recording time comes from captured PCM and matches the finalized WAV", () => {
  for (const [sampleRate, channels] of [
    [16000, 1],
    [48000, 2],
  ]) {
    const writer = new SessionWavWriter(`duration-${channels}`);
    assert.equal(writer.durationMs, 0);
    const bytesPerFrame = (sampleRate * channels * 2) / 10;
    for (let i = 0; i < 400; i++)
      writer.append(new ArrayBuffer(bytesPerFrame), sampleRate, channels);
    assert.equal(writer.durationMs, 40000);
    const file = writer.finalize();
    const header = new DataView(file.bytes.buffer);
    assert.equal(
      (header.getUint32(40, true) / header.getUint32(28, true)) * 1000,
      writer.durationMs,
    );
    assert.equal(file.size, 44 + bytesPerFrame * 400);
  }
});

test("failed audio writes do not advance the recording duration", () => {
  const writer = new SessionWavWriter("failed-write");
  writer.append(new ArrayBuffer(3200), 16000, 1);
  writer.file.failWrite = true;
  assert.throws(
    () => writer.append(new ArrayBuffer(3200), 16000, 1),
    /Disk write failed/,
  );
  assert.equal(writer.durationMs, 100);
  assert.equal(files.get("/test/sessions/failed-write/audio.wav").size, 3244);
});

test("a pause leaves no gap: the WAV holds only the captured audio, back to back", () => {
  const writer = new SessionWavWriter("paused");
  const before = new Uint8Array(3200).fill(1);
  const after = new Uint8Array(1600).fill(2);
  writer.append(before.buffer, 16000, 1);
  // Paused: the mic is off and native sends no buffers, so nothing is written.
  writer.append(after.buffer, 16000, 1);
  assert.equal(writer.durationMs, 150);

  const file = writer.finalize();
  const header = new DataView(file.bytes.buffer);
  assert.equal(header.getUint32(40, true), 4800);
  assert.deepEqual(file.bytes.slice(44, 44 + 3200), before);
  assert.deepEqual(file.bytes.slice(44 + 3200), after);
});

test("a part switch puts every buffer in exactly one part, in order", async () => {
  const buffer = (value) => new Uint8Array(3200).fill(value).buffer;
  let writer = new SessionWavWriter("part-1");
  let sent = 0;
  const send = () => {
    sent += 1;
    writer.append(buffer(sent), 16000, 1);
  };
  for (let i = 0; i < 5; i++) send();

  // The new note is created asynchronously; buffers keep arriving meanwhile
  // and still go to part 1.
  const noteCreated = Promise.resolve().then(() => {
    for (let i = 0; i < 3; i++) send();
  });
  await noteCreated;
  const previous = writer;
  const { next, finalizeError } = continueInNextPart(writer, "part-2");
  writer = next;
  for (let i = 0; i < 4; i++) send();
  writer.finalize();

  assert.equal(finalizeError, null);
  assert.equal(previous.isFinalized, true);
  const first = files.get("/test/sessions/part-1/audio.wav").bytes;
  const second = files.get("/test/sessions/part-2/audio.wav").bytes;
  assert.equal(new DataView(first.buffer).getUint32(40, true), 8 * 3200);
  assert.equal(new DataView(second.buffer).getUint32(40, true), 4 * 3200);
  const values = [...first.slice(44), ...second.slice(44)].filter(
    (_, index) => index % 3200 === 0,
  );
  assert.deepEqual(
    values,
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.equal(previous.durationMs + writer.durationMs, 12 * 100);
});

test("a part switch that can't open the next file leaves recording where it was", () => {
  const writer = new SessionWavWriter("stays");
  writer.append(new ArrayBuffer(3200), 16000, 1);
  const File = writer.file.constructor;
  const open = File.prototype.open;
  File.prototype.open = function () {
    if (this.path.includes("unopenable")) throw Error("No space left");
    return open.call(this);
  };
  try {
    assert.throws(
      () => continueInNextPart(writer, "unopenable"),
      /No space left/,
    );
  } finally {
    File.prototype.open = open;
  }
  assert.equal(writer.isFinalized, false);
  writer.append(new ArrayBuffer(3200), 16000, 1);
  assert.equal(writer.durationMs, 200);
});

test("a part switch hands back a failed finalize instead of throwing", () => {
  const writer = new SessionWavWriter("bad-header");
  writer.append(new ArrayBuffer(3200), 16000, 1);
  writer.file.failWrite = true;
  const { next, finalizeError } = continueInNextPart(
    writer,
    "after-bad-header",
  );
  assert.match(String(finalizeError), /Disk write failed/);
  next.append(new ArrayBuffer(3200), 16000, 1);
  assert.equal(next.durationMs, 100);
});

test("reports its size and whether it is finalized", () => {
  const writer = new SessionWavWriter("size");
  writer.append(new ArrayBuffer(3200), 16000, 1);
  assert.equal(writer.sizeBytes, 3244);
  assert.equal(writer.isFinalized, false);
  writer.finalize();
  assert.equal(writer.isFinalized, true);
  assert.equal(
    writer.sizeBytes,
    files.get("/test/sessions/size/audio.wav").size,
  );
});

test("recording more goes on the end of the note's recording", () => {
  const first = new SessionWavWriter("more");
  const before = new Uint8Array(3200).fill(1);
  first.append(before.buffer, 16000, 1);
  first.finalize();

  const more = new SessionWavWriter("more", { append: true });
  assert.equal(more.appended, true);
  assert.equal(more.durationMs, 100);
  assert.equal(more.addedMs, 0);
  const after = new Uint8Array(1600).fill(2);
  more.append(after.buffer, 16000, 1);
  // The timer shows only this recording; the file holds both.
  assert.equal(more.addedMs, 50);
  assert.equal(more.durationMs, 150);

  const file = more.finalize();
  const header = new DataView(file.bytes.buffer);
  assert.equal(header.getUint32(40, true), 4800);
  assert.equal(header.getUint32(4, true), 36 + 4800);
  assert.equal(file.size, 44 + 4800);
  assert.deepEqual(file.bytes.slice(44, 44 + 3200), before);
  assert.deepEqual(file.bytes.slice(44 + 3200), after);
});

test("recording more counts the audio from the file, not a stale header", () => {
  const first = new SessionWavWriter("cut-off");
  first.append(new ArrayBuffer(3200), 16000, 1);
  first.finalize();
  // Cut off before: the header says only half of what is there.
  const stored = files.get("/test/sessions/cut-off/audio.wav");
  new DataView(stored.bytes.buffer).setUint32(40, 1600, true);

  const more = new SessionWavWriter("cut-off", { append: true });
  assert.equal(more.durationMs, 100);
  more.append(new ArrayBuffer(3200), 16000, 1);
  more.finalize();
  assert.equal(new DataView(stored.bytes.buffer).getUint32(40, true), 6400);
  assert.equal(stored.size, 44 + 6400);
});

test("recording more needs a recording it can add to", () => {
  assert.throws(
    () => new SessionWavWriter("nothing-yet", { append: true }),
    /no recording to add to/,
  );
  const notWav = files.get("/test/sessions/nothing-yet/audio.wav");
  notWav.exists = true;
  notWav.bytes = new Uint8Array(200).fill(7);
  assert.throws(
    () => new SessionWavWriter("nothing-yet", { append: true }),
    /can't be added to/,
  );
  assert.equal(notWav.openHandles, 0);
  assert.equal(notWav.size, 200);
});

test("a start that fails while recording more keeps the earlier recording", () => {
  const first = new SessionWavWriter("keep-earlier");
  first.append(new ArrayBuffer(3200), 16000, 1);
  first.finalize();
  const more = new SessionWavWriter("keep-earlier", { append: true });
  more.closeAndDiscardEmpty();
  const stored = files.get("/test/sessions/keep-earlier/audio.wav");
  assert.equal(stored.exists, true);
  assert.equal(stored.size, 3244);
  assert.equal(new DataView(stored.bytes.buffer).getUint32(40, true), 3200);
});

test("a stream in another format can't be added to the recording", () => {
  const first = new SessionWavWriter("other-format");
  first.append(new ArrayBuffer(3200), 16000, 1);
  first.finalize();
  const more = new SessionWavWriter("other-format", { append: true });
  assert.throws(
    () => more.append(new ArrayBuffer(9600), 48000, 1),
    /format changed/,
  );
  assert.equal(more.addedMs, 0);
});
