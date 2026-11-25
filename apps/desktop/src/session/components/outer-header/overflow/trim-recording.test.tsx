import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIN = 60_000;

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  loadSessionPeaks: vi.fn(),
  loadTrimContext: vi.fn(),
  trimSessionRecording: vi.fn(),
  reloadSessionAudio: vi.fn(),
  requestAutoEnhance: vi.fn(),
  markSummaryOutdated: vi.fn(),
  clearSummaryOutdated: vi.fn(),
  toastSuccess: vi.fn(),
  summaries: { value: [] as { content: string }[] },
}));

vi.mock("~/audio-player/provider", () => ({
  useAudioPlayer: () => ({
    stop: mocks.stop,
    state: "stopped",
    pause: vi.fn(),
  }),
  useAudioTime: () => ({ current: 0, total: 0 }),
}));
vi.mock("~/audio-player/waveform", () => ({
  loadSessionPeaks: mocks.loadSessionPeaks,
  isUsablePeaks: (peaks: unknown) => peaks !== null,
}));
vi.mock("~/audio-player/clip", () => ({ createClipPlayer: vi.fn() }));
vi.mock("~/audio-player/reload", () => ({
  reloadSessionAudio: mocks.reloadSessionAudio,
}));
vi.mock("~/session/trim-recording", () => ({
  loadTrimContext: mocks.loadTrimContext,
  trimSessionRecording: mocks.trimSessionRecording,
  TrimRefusedError: class TrimRefusedError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
}));
vi.mock("~/session/queries", () => ({
  useEnhancedNoteRecords: () => mocks.summaries.value,
}));
vi.mock("~/session/components/shared", () => ({
  hasStoredNoteContent: (content: string) => content.length > 0,
}));
vi.mock("~/session/summary-outdated", () => ({
  markSummaryOutdated: mocks.markSummaryOutdated,
  clearSummaryOutdated: mocks.clearSummaryOutdated,
}));
vi.mock("~/services/enhancer", () => ({
  getEnhancerService: () => ({ requestAutoEnhance: mocks.requestAutoEnhance }),
}));
vi.mock("~/stt/contexts", () => ({
  useListener: (
    selector: (state: { getSessionMode: () => string }) => unknown,
  ) => selector({ getSessionMode: () => "inactive" }),
}));
vi.mock("@anlg/plugin-fs-sync", () => ({ commands: { audioPath: vi.fn() } }));
vi.mock("@anlg/ui/components/ui/toast", () => ({
  toast: { success: mocks.toastSuccess },
}));

import { TrimRecordingDialog } from "./trim-recording";

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TrimRecordingDialog
        sessionId="session-1"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

function context(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    transcriptCount: 1,
    talkEndsMs: 50 * MIN,
    fromPhone: false,
    ...overrides,
  };
}

describe("TrimRecordingDialog", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") mock.mockReset();
    }
    mocks.summaries.value = [];
    mocks.loadSessionPeaks.mockResolvedValue({
      duration: 90 * 60,
      channels: [
        Array.from({ length: 180 }, (_, index) => (index < 100 ? 0.5 : 0.01)),
      ],
    });
    mocks.loadTrimContext.mockResolvedValue(context());
    mocks.trimSessionRecording.mockResolvedValue({ audioTrimmed: true });
  });

  it("sends a phone's recording back to the phone", async () => {
    mocks.loadTrimContext.mockResolvedValue(context({ fromPhone: true }));
    renderDialog();

    expect(
      await screen.findByText(/This recording came from your phone/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cut the last/ })).toBeNull();
  });

  it("explains why a note recorded in parts can't be trimmed", async () => {
    mocks.loadTrimContext.mockResolvedValue(context({ transcriptCount: 2 }));
    renderDialog();

    expect(
      await screen.findByText(/recorded in more than one part/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cut the last/ })).toBeNull();
  });

  it("starts at the suggested end and offers the quick cuts", async () => {
    renderDialog();

    expect(
      await screen.findByText(/The talking seems to stop around 50:00/),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("button", { name: /^Cut the last \d+ minutes$/ })
        .map((button) => button.textContent),
    ).toEqual(["−5 min", "−10 min", "−15 min", "−30 min", "−60 min"]);
    expect(screen.getByText("Ends at 50:30 · cuts 40 min")).toBeTruthy();
    expect(screen.getByText(/This can't be undone/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Cut the last 15 minutes" }),
    );
    expect(screen.getByText("Ends at 1:15:00 · cuts 15 min")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cut the last 15 min" }),
    ).toBeTruthy();
  });

  it("keeps at least 30 s when the end is dragged to the start", async () => {
    renderDialog();

    fireEvent.change(
      await screen.findByRole("slider", { name: "Where the recording ends" }),
      { target: { value: "0" } },
    );
    expect(screen.getByText("Ends at 0:30 · cuts 1 h 30 min")).toBeTruthy();
  });

  it("trims, reloads the player and writes the summary again", async () => {
    mocks.summaries.value = [{ content: "summary" }];
    const onOpenChange = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Cut the last 40 min" }),
    );

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.trimSessionRecording).toHaveBeenCalledWith(
      "session-1",
      50 * MIN + 30_000,
      { requestedBy: "mac" },
    );
    expect(mocks.reloadSessionAudio).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Recording trimmed",
      expect.objectContaining({ description: "Cut the last 40 min." }),
    );
    await waitFor(() => {
      expect(mocks.requestAutoEnhance).toHaveBeenCalledWith(
        "session-1",
        "refresh",
      );
    });
    expect(mocks.clearSummaryOutdated).toHaveBeenCalledWith("session-1");
  });

  it("marks the summary out of date when asked not to rewrite it", async () => {
    mocks.summaries.value = [{ content: "summary" }];
    renderDialog();

    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Write the summary again too",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cut the last 40 min" }),
    );

    await waitFor(() => {
      expect(mocks.markSummaryOutdated).toHaveBeenCalledWith("session-1");
    });
    expect(mocks.requestAutoEnhance).not.toHaveBeenCalled();
  });

  it("says so when the trim fails, and stays open", async () => {
    mocks.trimSessionRecording.mockRejectedValue(new Error("disk_full"));
    const onOpenChange = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Cut the last 40 min" }),
    );

    expect(
      await screen.findByText("Couldn't trim this recording."),
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.reloadSessionAudio).toHaveBeenCalled();
  });
});
