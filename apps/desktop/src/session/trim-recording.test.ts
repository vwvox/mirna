import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audioTrim: vi.fn(),
  listLinkedNotes: vi.fn(),
  execute: vi.fn(),
  catalogLocalSessionAudio: vi.fn(),
  trimTranscriptAfter: vi.fn(),
  getSessionTranscriptRecords: vi.fn(),
}));

vi.mock("@anlg/plugin-fs-sync", () => ({
  commands: { audioTrim: mocks.audioTrim },
}));
vi.mock("@anlg/plugin-phone-link", () => ({
  commands: { listLinkedNotes: mocks.listLinkedNotes },
}));
vi.mock("~/db", () => ({ liveQueryClient: { execute: mocks.execute } }));
vi.mock("~/session/attachments", () => ({
  catalogLocalSessionAudio: mocks.catalogLocalSessionAudio,
}));
vi.mock("~/session/audio-operations", () => ({
  enqueueSessionAudioOperation: (_id: string, run: () => unknown) => run(),
}));
vi.mock("~/stt/queries", () => ({
  trimTranscriptAfter: mocks.trimTranscriptAfter,
  getSessionTranscriptRecords: mocks.getSessionTranscriptRecords,
}));

import {
  isPhoneNote,
  loadTrimContext,
  TrimRefusedError,
  trimSessionRecording,
} from "./trim-recording";

function refusal(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) =>
      error instanceof TrimRefusedError ? error.reason : error,
  );
}

describe("trimming a note's recording", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.execute.mockResolvedValue([{ id: "transcript-1" }]);
    mocks.audioTrim.mockResolvedValue({ status: "ok", data: "/s/audio.mp3" });
    mocks.listLinkedNotes.mockResolvedValue({ status: "ok", data: [] });
    mocks.trimTranscriptAfter.mockResolvedValue({ removedWords: 3 });
  });

  it("cuts the audio, catalogs it and drops the words after the cut", async () => {
    await expect(
      trimSessionRecording("session-1", 600_000, { requestedBy: "mac" }),
    ).resolves.toEqual({ audioTrimmed: true });
    expect(mocks.audioTrim).toHaveBeenCalledWith("session-1", 600_000);
    expect(mocks.catalogLocalSessionAudio).toHaveBeenCalledWith("session-1");
    expect(mocks.trimTranscriptAfter).toHaveBeenCalledWith(
      "transcript-1",
      600_000,
    );
  });

  it("still trims the words when this Mac has no audio", async () => {
    mocks.audioTrim.mockResolvedValue({ status: "ok", data: null });
    await expect(
      trimSessionRecording("session-1", 600_000, { requestedBy: "phone" }),
    ).resolves.toEqual({ audioTrimmed: false });
    expect(mocks.catalogLocalSessionAudio).not.toHaveBeenCalled();
    expect(mocks.trimTranscriptAfter).toHaveBeenCalled();
  });

  it("leaves the transcript alone when the audio can't be cut", async () => {
    mocks.audioTrim.mockResolvedValue({ status: "error", error: "disk_full" });
    await expect(
      trimSessionRecording("session-1", 600_000, { requestedBy: "mac" }),
    ).rejects.toThrow("disk_full");
    expect(mocks.trimTranscriptAfter).not.toHaveBeenCalled();
  });

  it("refuses to keep less than a second", async () => {
    for (const keepMs of [0, 999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        await refusal(
          trimSessionRecording("session-1", keepMs, { requestedBy: "mac" }),
        ),
      ).toBe("too_short");
    }
    expect(mocks.audioTrim).not.toHaveBeenCalled();
  });

  it("refuses a note recorded in several parts, from either device", async () => {
    mocks.execute.mockResolvedValue([{ id: "first" }, { id: "second" }]);
    for (const requestedBy of ["mac", "phone"] as const) {
      expect(
        await refusal(
          trimSessionRecording("session-1", 600_000, { requestedBy }),
        ),
      ).toBe("several_parts");
    }
    expect(mocks.audioTrim).not.toHaveBeenCalled();
    expect(mocks.trimTranscriptAfter).not.toHaveBeenCalled();
  });

  it("won't cut a phone's recording when asked on this Mac", async () => {
    mocks.listLinkedNotes.mockResolvedValue({
      status: "ok",
      data: [{ recording_id: "rec-1", session_id: "session-1" }],
    });
    expect(
      await refusal(
        trimSessionRecording("session-1", 600_000, { requestedBy: "mac" }),
      ),
    ).toBe("from_phone");
    expect(mocks.audioTrim).not.toHaveBeenCalled();
  });

  it("cuts a phone's recording when the phone asks", async () => {
    mocks.listLinkedNotes.mockResolvedValue({
      status: "ok",
      data: [{ recording_id: "rec-1", session_id: "session-1" }],
    });
    await trimSessionRecording("session-1", 600_000, { requestedBy: "phone" });
    expect(mocks.listLinkedNotes).not.toHaveBeenCalled();
    expect(mocks.audioTrim).toHaveBeenCalledWith("session-1", 600_000);
  });
});

describe("recognising a phone's note", () => {
  beforeEach(() => {
    mocks.listLinkedNotes.mockReset();
  });

  it("matches the notes the phone link made", async () => {
    mocks.listLinkedNotes.mockResolvedValue({
      status: "ok",
      data: [{ recording_id: "rec-1", session_id: "session-1" }],
    });
    expect(await isPhoneNote("session-1")).toBe(true);
    expect(await isPhoneNote("session-2")).toBe(false);
  });

  it("treats an unavailable phone link as no phone note", async () => {
    mocks.listLinkedNotes.mockResolvedValue({
      status: "error",
      error: "Phone link is unavailable",
    });
    expect(await isPhoneNote("session-1")).toBe(false);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listLinkedNotes.mockRejectedValue(new Error("ipc"));
    expect(await isPhoneNote("session-1")).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("what the Trim dialog is told", () => {
  it("counts transcripts and finds when the talking ends", async () => {
    mocks.listLinkedNotes.mockResolvedValue({ status: "ok", data: [] });
    mocks.getSessionTranscriptRecords.mockResolvedValue([
      {
        id: "transcript-1",
        words: [
          { id: "a", text: "hi", start_ms: 0, end_ms: 400, channel: 0 },
          { id: "b", text: "bye", start_ms: 3_000, end_ms: 3_600, channel: 0 },
        ],
      },
    ]);
    await expect(loadTrimContext("session-1")).resolves.toEqual({
      transcriptCount: 1,
      talkEndsMs: 3_600,
      fromPhone: false,
    });
  });
});
