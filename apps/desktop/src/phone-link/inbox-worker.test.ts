import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxEntry, InboxJob } from "@anlg/plugin-phone-link";

const mocks = vi.hoisted(() => ({
  audioPath: vi.fn(),
  audioTrim: vi.fn(),
  audioImport: vi.fn(),
  isModelDownloaded: vi.fn(),
  updateRecording: vi.fn(),
  execute: vi.fn(),
  enhanceAndWait: vi.fn(),
  markSummaryOutdated: vi.fn(),
  clearSummaryOutdated: vi.fn(),
  trimTranscriptAfter: vi.fn(),
  catalogLocalSessionAudio: vi.fn(),
  existingCaptureInterval: vi.fn(),
  publishLinkedNotes: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@anlg/plugin-fs-sync", () => ({
  commands: {
    audioPath: mocks.audioPath,
    audioTrim: mocks.audioTrim,
    audioImport: mocks.audioImport,
  },
}));
vi.mock("@anlg/plugin-local-stt", () => ({
  commands: { isModelDownloaded: mocks.isModelDownloaded },
}));
vi.mock("@anlg/plugin-phone-link", () => ({
  commands: { updateRecording: mocks.updateRecording },
  events: { phoneLinkEvent: { listen: vi.fn() } },
}));
vi.mock("~/db", () => ({ liveQueryClient: { execute: mocks.execute } }));
vi.mock("~/services/enhancer", () => ({
  getEnhancerService: () => ({ enhanceAndWait: mocks.enhanceAndWait }),
}));
vi.mock("~/session/summary-outdated", () => ({
  markSummaryOutdated: mocks.markSummaryOutdated,
  clearSummaryOutdated: mocks.clearSummaryOutdated,
}));
vi.mock("~/stt/queries", () => ({
  trimTranscriptAfter: mocks.trimTranscriptAfter,
}));
vi.mock("~/session/attachments", () => ({
  catalogLocalSessionAudio: mocks.catalogLocalSessionAudio,
}));
vi.mock("~/session/audio-operations", () => ({
  enqueueSessionAudioOperation: (_id: string, run: () => unknown) => run(),
}));
vi.mock("~/session/components/note-input/transcript/actions", () => ({
  existingCaptureInterval: mocks.existingCaptureInterval,
}));
vi.mock("~/phone-link/notes-publisher", () => ({
  publishLinkedNotes: mocks.publishLinkedNotes,
}));
vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: mocks.snapshot,
}));
vi.mock("~/session/queries", () => ({
  updateSession: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("~/session/queries/creation", () => ({ createSession: vi.fn() }));
vi.mock("~/settings/providers", () => ({ useAiProvidersState: vi.fn() }));
vi.mock("~/settings/queries", () => ({ useSettingsReady: vi.fn() }));
vi.mock("~/stt/contexts", () => ({ useListener: vi.fn() }));
vi.mock("~/stt/useRunBatch", () => ({
  useRunBatch: vi.fn(),
  isStoppedTranscriptionError: () => false,
}));

import { processJob } from "./inbox-worker";

const item: InboxEntry = {
  id: "rec-1",
  audio_path: "/inbox/rec-1/audio.wav",
  title: null,
  started_at: "2026-11-24T12:35:16.420Z",
  duration_ms: 5_445_900,
  notes_md: null,
  phone_name: "Phone",
  received_at_ms: 0,
  state: "queued",
  stage: null,
  session_id: "session-1",
  job: null,
};

function updates() {
  return mocks.updateRecording.mock.calls.map((call) => call[1]);
}

function lastUpdate() {
  const all = updates();
  return all[all.length - 1];
}

describe("work the phone asks for on a note", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.updateRecording.mockResolvedValue({ status: "ok", data: null });
    mocks.audioPath.mockResolvedValue({ status: "ok", data: "/s/audio.mp3" });
    mocks.isModelDownloaded.mockResolvedValue({ status: "ok", data: true });
    mocks.snapshot.mockResolvedValue({
      title: "Chinese lesson",
      enhancedNotes: [{ position: 0, markdown: "# Summary" }],
    });
    mocks.execute.mockResolvedValue([{ id: "transcript-1" }]);
    mocks.audioTrim.mockResolvedValue({ status: "ok", data: "/s/audio.mp3" });
  });

  it("transcribes again with Qwen3-ASR, dated when the phone recorded it", async () => {
    const runBatch = vi.fn().mockResolvedValue(undefined);
    const job: InboxJob = {
      type: "retranscribe",
      engine: "qwen3",
      update_summary: true,
    };
    await processJob(item, job, "session-1", runBatch);

    expect(runBatch).toHaveBeenCalledWith("/s/audio.mp3", {
      promotion: { scope: "whole_session" },
      provider: "soniqo",
      model: "soniqo-qwen3-small",
      captureInterval: {
        startedAtMs: Date.parse("2026-11-24T12:35:16.420Z"),
        stoppedAtMs: Date.parse("2026-11-24T12:35:16.420Z") + 5_445_900,
      },
    });
    expect(mocks.enhanceAndWait).toHaveBeenCalledWith("session-1");
    expect(mocks.markSummaryOutdated).not.toHaveBeenCalled();
    expect(updates().map((update) => update.type)).toEqual([
      "processing",
      "processing",
      "done",
    ]);
    expect(updates()[1]).toMatchObject({ stage: "summarizing" });
    expect(updates()[2]).toMatchObject({
      title: "Chinese lesson",
      summary_md: "# Summary",
    });
    expect(mocks.publishLinkedNotes).toHaveBeenCalled();
  });

  it("says so when the engine isn't downloaded on the Mac", async () => {
    mocks.isModelDownloaded.mockResolvedValue({ status: "ok", data: false });
    const runBatch = vi.fn();
    await processJob(
      item,
      { type: "retranscribe", engine: "qwen3", update_summary: true },
      "session-1",
      runBatch,
    );
    expect(runBatch).not.toHaveBeenCalled();
    expect(lastUpdate()).toEqual({
      type: "failed",
      error:
        "Qwen3-ASR isn't downloaded on the Mac. Download it in Mirna on your Mac, then try again.",
      session_id: "session-1",
    });
  });

  it("uses the Mac's settings for Automatic", async () => {
    const runBatch = vi.fn().mockResolvedValue(undefined);
    await processJob(
      { ...item, started_at: null, duration_ms: null },
      { type: "retranscribe", engine: "auto", update_summary: false },
      "session-1",
      runBatch,
    );
    expect(mocks.isModelDownloaded).not.toHaveBeenCalled();
    expect(runBatch.mock.calls[0]?.[1]).not.toHaveProperty("model");
    expect(mocks.existingCaptureInterval).toHaveBeenCalledWith("session-1");
    // Left as it was, but marked out of date on the Mac.
    expect(mocks.enhanceAndWait).not.toHaveBeenCalled();
    expect(mocks.markSummaryOutdated).toHaveBeenCalledWith("session-1");
  });

  it("cuts the audio and the words after the cut", async () => {
    await processJob(
      item,
      { type: "trim", keep_ms: 3_000_000, update_summary: false },
      "session-1",
      vi.fn(),
    );
    expect(mocks.audioTrim).toHaveBeenCalledWith("session-1", 3_000_000);
    expect(mocks.catalogLocalSessionAudio).toHaveBeenCalledWith("session-1");
    expect(mocks.trimTranscriptAfter).toHaveBeenCalledWith(
      "transcript-1",
      3_000_000,
    );
    expect(updates()[0]).toMatchObject({ stage: "trimming" });
    expect(lastUpdate()?.type).toBe("done");
  });

  it("won't trim a note that has recordings added on the Mac", async () => {
    mocks.execute.mockResolvedValue([{ id: "phone" }, { id: "mac" }]);
    await processJob(
      item,
      { type: "trim", keep_ms: 60_000, update_summary: true },
      "session-1",
      vi.fn(),
    );
    expect(mocks.audioTrim).not.toHaveBeenCalled();
    expect(mocks.trimTranscriptAfter).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({
      type: "failed",
      error:
        "This note has recordings added on the Mac, so it can't be trimmed from the phone yet.",
    });
  });

  it("makes the note again from the longer recording the phone sent", async () => {
    mocks.audioImport.mockResolvedValue({ status: "ok", data: "/s/audio.mp3" });
    const runBatch = vi.fn().mockResolvedValue(undefined);
    await processJob(
      item,
      { type: "extend", update_summary: true },
      "session-1",
      runBatch,
    );

    // Same note: its audio is replaced by the longer file, not a new note.
    expect(mocks.audioImport).toHaveBeenCalledWith(
      "session-1",
      "/inbox/rec-1/audio.wav",
    );
    expect(mocks.catalogLocalSessionAudio).toHaveBeenCalledWith("session-1");
    expect(runBatch).toHaveBeenCalledWith("/s/audio.mp3", {
      promotion: { scope: "whole_session" },
      captureInterval: {
        startedAtMs: Date.parse("2026-11-24T12:35:16.420Z"),
        stoppedAtMs: Date.parse("2026-11-24T12:35:16.420Z") + 5_445_900,
      },
    });
    expect(mocks.enhanceAndWait).toHaveBeenCalledWith("session-1");
    expect(
      updates()
        .filter((update) => update.type === "processing")
        .map((update) => update.stage),
    ).toEqual(["importing", "transcribing", "summarizing"]);
    expect(lastUpdate()).toMatchObject({
      type: "done",
      session_id: "session-1",
      summary_md: "# Summary",
    });
  });

  it("won't replace a note's audio that has a recording added on the Mac", async () => {
    mocks.execute.mockResolvedValue([{ id: "phone" }, { id: "mac" }]);
    const runBatch = vi.fn();
    await processJob(
      item,
      { type: "extend", update_summary: true },
      "session-1",
      runBatch,
    );
    expect(mocks.audioImport).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
    expect(lastUpdate()).toMatchObject({
      type: "failed",
      error:
        "This note has a recording added on the Mac, so what you recorded on the phone can't be added to it yet.",
      session_id: "session-1",
    });
  });
});
