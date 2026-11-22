import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { beginCloudsyncActivity, endCloudsyncActivity } from "@anlg/plugin-db";

const mocks = vi.hoisted(() => ({
  audioPath: vi.fn(),
  handleBatchFailed: vi.fn(),
  queueAutoEnhanceIfSummaryEmpty: vi.fn(),
  runBatch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  markSummaryOutdated: vi.fn(),
  clearSummaryOutdated: vi.fn(),
  requestAutoEnhance: vi.fn(),
}));

vi.mock("~/session/summary-outdated", () => ({
  markSummaryOutdated: mocks.markSummaryOutdated,
  clearSummaryOutdated: mocks.clearSummaryOutdated,
}));

vi.mock("@anlg/plugin-fs-sync", () => ({
  commands: { audioPath: mocks.audioPath },
}));

vi.mock("@anlg/ui/components/ui/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("~/services/enhancer", () => ({
  getEnhancerService: () => ({
    queueAutoEnhanceIfSummaryEmpty: mocks.queueAutoEnhanceIfSummaryEmpty,
    requestAutoEnhance: mocks.requestAutoEnhance,
  }),
}));

vi.mock("~/stt/contexts", () => ({
  useListener: (selector: (state: unknown) => unknown) =>
    selector({ handleBatchFailed: mocks.handleBatchFailed }),
}));

vi.mock("~/stt/useRunBatch", () => ({
  isStoppedTranscriptionError: (error: unknown) =>
    error instanceof Error && error.message === "Transcription stopped.",
  useRunBatch: () => mocks.runBatch,
}));

import { useRegenerateTranscript } from "./actions";

describe("useRegenerateTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audioPath.mockResolvedValue({
      status: "ok",
      data: "/tmp/session.wav",
    });
  });

  it("offers to update a summary written from the old transcript", async () => {
    mocks.runBatch.mockResolvedValue(undefined);
    mocks.queueAutoEnhanceIfSummaryEmpty.mockResolvedValue({
      type: "summary_exists",
      noteId: "summary:session-1",
    });
    const { result } = renderHook(() => useRegenerateTranscript("session-1"));

    await act(async () => {
      await result.current();
    });

    expect(mocks.markSummaryOutdated).toHaveBeenCalledWith("session-1");
    const [title, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(title).toBe("Transcript updated");
    expect(options.action.label).toBe("Update summary");

    options.action.onClick();
    expect(mocks.clearSummaryOutdated).toHaveBeenCalledWith("session-1");
    expect(mocks.requestAutoEnhance).toHaveBeenCalledWith(
      "session-1",
      "refresh",
    );
  });

  it("doesn't offer an update when the summary is written fresh", async () => {
    mocks.runBatch.mockResolvedValue(undefined);
    mocks.queueAutoEnhanceIfSummaryEmpty.mockResolvedValue({ type: "queued" });
    const { result } = renderHook(() => useRegenerateTranscript("session-1"));

    await act(async () => {
      await result.current();
    });

    expect(mocks.markSummaryOutdated).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("shows batch transcription failures even when an old transcript exists", async () => {
    mocks.runBatch.mockRejectedValue(new Error("Authentication failed"));
    const { result } = renderHook(() => useRegenerateTranscript("session-1"));

    await act(async () => {
      await result.current();
    });

    expect(mocks.runBatch).toHaveBeenCalledWith("/tmp/session.wav", {
      promotion: { scope: "whole_session" },
    });
    expect(mocks.handleBatchFailed).toHaveBeenCalledWith(
      "session-1",
      "Authentication failed",
    );
    expect(mocks.toastError).toHaveBeenCalledWith("Re-transcription failed", {
      id: "transcript-regenerate-failed-session-1",
      description: "Authentication failed",
    });
  });

  it("keeps CloudSync deferred until summary scheduling settles", async () => {
    let finishSummaryScheduling: (() => void) | undefined;
    mocks.runBatch.mockResolvedValue(undefined);
    mocks.queueAutoEnhanceIfSummaryEmpty.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSummaryScheduling = resolve;
      }),
    );
    const { result } = renderHook(() => useRegenerateTranscript("session-1"));

    const regeneration = result.current();
    await waitFor(() => {
      expect(mocks.queueAutoEnhanceIfSummaryEmpty).toHaveBeenCalledWith(
        "session-1",
      );
    });

    expect(beginCloudsyncActivity).toHaveBeenCalledWith(
      "transcription",
      expect.stringMatching(/^session-1:retranscription:/),
    );
    expect(endCloudsyncActivity).not.toHaveBeenCalled();

    finishSummaryScheduling?.();
    await act(async () => {
      await regeneration;
    });
    expect(endCloudsyncActivity).toHaveBeenCalledWith(
      "transcription",
      vi.mocked(beginCloudsyncActivity).mock.calls[0]?.[1],
    );
  });
});
