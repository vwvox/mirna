import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  dictationAction: null as
    | null
    | ((event: { payload: { sessionId: string; action: string } }) => void),
  meetingStop: null as null | (() => void),
  mark: null as
    | null
    | ((event: { payload: { sessionId: string; kind: string } }) => void),
  addLessonMark: vi.fn(async () => null),
  meetingPause: null as
    | null
    | ((event: { payload: { paused: boolean } }) => void),
  settings: {
    current: {
      floating_bar_opacity: 0.78,
      live_caption_opacity: 0.3,
      live_caption_width: 440,
      live_caption_line_count: 1,
      live_caption_position: "topCenter",
      live_caption_minimized: true,
    },
  },
  floatingBarShow: vi.fn(async () => ({ status: "ok", data: null })),
  floatingBarHide: vi.fn(async () => ({ status: "ok", data: null })),
  floatingBarUpdate: vi.fn(async () => ({ status: "ok", data: null })),
  liveCaptionShow: vi.fn(async () => ({ status: "ok", data: null })),
  liveCaptionHide: vi.fn(async () => ({ status: "ok", data: null })),
  liveCaptionUpdate: vi.fn(async () => ({ status: "ok", data: null })),
  windowShow: vi.fn(async () => ({ status: "ok", data: null })),
  listen: vi.fn(async () => vi.fn()),
  setSettingValue: vi.fn(async () => undefined),
  setSettingValues: vi.fn(),
  subscribeMeetingFloatData: vi.fn(async (_onData: (data: unknown) => void) =>
    vi.fn(async () => undefined),
  ),
  listenerState: {
    live: {
      status: "active",
      sessionId: "session-1",
      amplitude: { mic: 0, speaker: 0 },
      captureHealth: { mic: null, speaker: null, unavailable: false },
      degraded: null,
      lastError: null,
      liveTranscriptionActive: true,
      paused: false,
    },
    liveSegments: [],
    liveCaptionText: "we should ship this",
    stop: vi.fn(),
    setPaused: vi.fn(async () => true),
  },
  subscribeListener: vi.fn(() => vi.fn()),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
}));

vi.mock("@anlg/plugin-windows", () => ({
  commands: {
    floatingBarShow: mocks.floatingBarShow,
    floatingBarHide: mocks.floatingBarHide,
    floatingBarUpdate: mocks.floatingBarUpdate,
    liveCaptionShow: mocks.liveCaptionShow,
    liveCaptionHide: mocks.liveCaptionHide,
    liveCaptionUpdate: mocks.liveCaptionUpdate,
    windowShow: mocks.windowShow,
  },
  events: {
    floatingBarOpenMain: { listen: mocks.listen },
    floatingBarSettingsChange: { listen: mocks.listen },
    floatingBarStop: {
      listen: vi.fn(async (callback) => {
        mocks.meetingStop = callback;
        return vi.fn();
      }),
    },
    floatingBarPause: {
      listen: vi.fn(async (callback) => {
        mocks.meetingPause = callback;
        return vi.fn();
      }),
    },
    floatingBarDictationAction: {
      listen: vi.fn(async (callback) => {
        mocks.dictationAction = callback;
        return vi.fn();
      }),
    },
    floatingBarMark: {
      listen: vi.fn(async (callback) => {
        mocks.mark = callback;
        return vi.fn();
      }),
    },
  },
}));

vi.mock("~/lesson/marks", () => ({ addLessonMark: mocks.addLessonMark }));
vi.mock("~/lesson/queries", () => ({ LESSON_SESSION_KIND: "lesson" }));

vi.mock("./hooks", () => ({
  createMeetingFloatLabelContext: vi.fn(() => undefined),
  createMeetingFloatRenderRequest: vi.fn(() => null),
  loadMeetingFloatData: vi.fn(async () => ({ sessions: {}, humanNames: {} })),
  subscribeMeetingFloatData: mocks.subscribeMeetingFloatData,
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: vi.fn(async () => ({
    values: mocks.settings.current,
    hasValues: new Set(Object.keys(mocks.settings.current)),
  })),
  setSettingValue: mocks.setSettingValue,
  useSetSettingValues: () => mocks.setSettingValues,
  useStoredSettingValue: () => ({ value: undefined, hasValue: false }),
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.enabled,
  useConfigValues: () => mocks.settings.current,
}));

vi.mock("~/store/zustand/listener/instance", () => ({
  listenerStore: {
    getState: () => mocks.listenerState,
    subscribe: mocks.subscribeListener,
  },
}));

import { FloatingMeetingWindowHost } from "./host";

import { useDictationStatus } from "~/dictation/state";

describe("FloatingMeetingWindowHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.meetingStop = null;
    mocks.meetingPause = null;
    mocks.dictationAction = null;
    mocks.mark = null;
    mocks.listenerState.live.sessionId = "session-1";
    mocks.enabled = true;
    mocks.listenerState.live.status = "active";
    useDictationStatus.setState(useDictationStatus.getInitialState());
    mocks.settings.current = {
      floating_bar_opacity: 0.78,
      live_caption_opacity: 0.3,
      live_caption_width: 440,
      live_caption_line_count: 1,
      live_caption_position: "topCenter",
      live_caption_minimized: true,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("updates overlay settings without hiding the active floating panel", async () => {
    const view = render(<FloatingMeetingWindowHost />);

    await waitFor(() => {
      expect(mocks.floatingBarShow).toHaveBeenCalledOnce();
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ liveCaptionMinimized: true }),
      );
    });

    mocks.settings.current = {
      ...mocks.settings.current,
      live_caption_minimized: false,
    };
    view.rerender(<FloatingMeetingWindowHost />);

    await waitFor(() => {
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          liveCaptionMinimized: false,
          transcriptBubbles: null,
        }),
      );
    });
    expect(mocks.liveCaptionShow).not.toHaveBeenCalled();
    expect(mocks.liveCaptionHide).toHaveBeenCalled();
    expect(mocks.floatingBarShow).toHaveBeenCalledOnce();
    expect(mocks.floatingBarHide).not.toHaveBeenCalled();
  });

  it("keeps dictation usable when meeting panels are disabled on macos", async () => {
    mocks.enabled = false;
    mocks.listenerState.live.status = "inactive";
    const finish = vi.fn();
    const cancel = vi.fn();
    useDictationStatus.setState({
      phase: "recording",
      owner: "dictation-1",
      text: "Hello",
      finish,
      cancel,
    });
    render(<FloatingMeetingWindowHost />);
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dictation: expect.objectContaining({ text: "Hello" }),
        }),
      ),
    );
    expect(mocks.floatingBarUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.floatingBarShow.mock.invocationCallOrder[0]!,
    );
    await act(async () => {
      mocks.dictationAction!({
        payload: { sessionId: "old-recording", action: "finish" },
      });
      mocks.meetingStop!();
    });
    expect(finish).not.toHaveBeenCalled();
    expect(mocks.listenerState.stop).not.toHaveBeenCalled();
    expect(mocks.floatingBarHide).not.toHaveBeenCalled();
    await act(async () => {
      mocks.dictationAction!({
        payload: { sessionId: "dictation-1", action: "togglePreview" },
      });
    });
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ liveCaptionMinimized: false }),
      ),
    );
    await act(async () => {
      mocks.dictationAction!({
        payload: { sessionId: "dictation-1", action: "finish" },
      });
      mocks.dictationAction!({
        payload: { sessionId: "dictation-1", action: "cancel" },
      });
    });
    expect(finish).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => {
      useDictationStatus.setState({ phase: "idle" });
    });
    await waitFor(() => expect(mocks.floatingBarHide).toHaveBeenCalledOnce());
  });

  it("shows lesson marks for a lesson recording and records each press", async () => {
    mocks.subscribeMeetingFloatData.mockImplementationOnce(
      async (onData: (data: unknown) => void) => {
        onData({
          sessions: {
            "session-1": {
              title: "Biology",
              kind: "lesson",
              ownerUserId: "",
              participantHumanIds: [],
              speakerContext: { intervals: [] },
              liveStartedAtMs: null,
            },
          },
          humanNames: {},
        });
        return vi.fn(async () => undefined);
      },
    );
    render(<FloatingMeetingWindowHost />);
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: "session-1", marksEnabled: true }),
      ),
    );

    await act(async () => {
      mocks.mark!({ payload: { sessionId: "other", kind: "important" } });
      mocks.mark!({ payload: { sessionId: "session-1", kind: "starred" } });
      mocks.mark!({ payload: { sessionId: "session-1", kind: "confused" } });
    });
    expect(mocks.addLessonMark).toHaveBeenCalledOnce();
    expect(mocks.addLessonMark).toHaveBeenCalledWith("session-1", "confused");
  });

  it("ignores marks for a recording that is not a lesson", async () => {
    render(<FloatingMeetingWindowHost />);
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ marksEnabled: false }),
      ),
    );
    await act(async () => {
      mocks.mark!({ payload: { sessionId: "session-1", kind: "important" } });
    });
    expect(mocks.addLessonMark).not.toHaveBeenCalled();
  });

  it("gives an active meeting ownership of the panel", async () => {
    useDictationStatus.setState({ phase: "recording", owner: "dictation-1" });
    render(<FloatingMeetingWindowHost />);
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ dictation: null }),
      ),
    );
    expect(mocks.floatingBarShow).toHaveBeenCalledOnce();
  });

  it("pauses and resumes the meeting from the floating bar", async () => {
    render(<FloatingMeetingWindowHost />);
    await waitFor(() => expect(mocks.meetingPause).not.toBeNull());

    await act(async () => {
      mocks.meetingPause!({ payload: { paused: true } });
    });
    expect(mocks.listenerState.setPaused).toHaveBeenLastCalledWith(true);

    await act(async () => {
      mocks.meetingPause!({ payload: { paused: false } });
    });
    expect(mocks.listenerState.setPaused).toHaveBeenLastCalledWith(false);
    expect(mocks.listenerState.stop).not.toHaveBeenCalled();
  });

  it("ignores pause requests while dictating", async () => {
    mocks.listenerState.live.status = "inactive";
    useDictationStatus.setState({ phase: "recording", owner: "dictation-1" });
    render(<FloatingMeetingWindowHost />);
    await waitFor(() =>
      expect(mocks.floatingBarUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dictation: expect.objectContaining({ sessionId: "dictation-1" }),
        }),
      ),
    );

    await act(async () => {
      mocks.meetingPause!({ payload: { paused: true } });
    });
    expect(mocks.listenerState.setPaused).not.toHaveBeenCalled();
  });
});
