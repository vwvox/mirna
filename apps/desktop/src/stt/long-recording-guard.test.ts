import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@anlg/plugin-notification", () => ({
  commands: { showNotification: vi.fn() },
  events: { notificationEvent: { listen: vi.fn() } },
}));
vi.mock("@anlg/plugin-transcription", () => ({
  events: { captureDataEvent: { listen: vi.fn() } },
}));
vi.mock("~/store/zustand/listener/instance", () => ({
  listenerStore: { getState: vi.fn(), subscribe: vi.fn() },
}));
vi.mock("~/store/zustand/tabs", () => ({ useTabs: vi.fn() }));

import { SILENCE_ALERT_MS, SILENCE_PAUSE_MS } from "./long-recording";
import {
  createLongRecordingGuard,
  parseLongRecordingNotificationKey,
} from "./long-recording-guard";

const HOUR = 3_600_000;

function setup() {
  const listener = {
    live: {
      status: "active",
      sessionId: "s1",
      seconds: 0,
      paused: false,
    },
    setPaused: vi.fn(async (value: boolean) => {
      listener.live.paused = value;
      guard.onPausedChange(value);
      return true;
    }),
    stop: vi.fn(() => {
      listener.live.status = "inactive";
    }),
  };
  let now = 0;
  const notify = vi.fn(async () => {});
  const openNote = vi.fn();
  const guard = createLongRecordingGuard({
    getListener: () => listener,
    notify,
    openNote,
    now: () => now,
    newId: () => "n",
  });
  const at = async (ms: number, wallMs = now) => {
    listener.live.seconds = ms / 1000;
    now = wallMs;
    await guard.tick();
  };
  return { guard, listener, notify, openNote, at };
}

describe("createLongRecordingGuard", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  test("asks Still recording? after 15 min with nobody talking", async () => {
    await ctx.at(SILENCE_ALERT_MS);

    expect(ctx.notify).toHaveBeenCalledWith(
      "silence",
      "long-recording:silence:s1:n",
    );
  });

  test("no alert while people keep talking", async () => {
    await ctx.at(10 * 60_000);
    ctx.guard.onSpeech("s1");
    await ctx.at(11 * 60_000);
    await ctx.at(SILENCE_ALERT_MS + 60_000);

    expect(ctx.notify).not.toHaveBeenCalled();
  });

  test("Stop & save stops, Keep going restarts the quiet clock", async () => {
    await ctx.at(SILENCE_ALERT_MS);
    await ctx.guard.onNotification({
      type: "notification_footer_action",
      key: "long-recording:silence:s1:n",
      source: null,
    });
    await ctx.at(SILENCE_PAUSE_MS);
    expect(ctx.listener.setPaused).not.toHaveBeenCalled();

    await ctx.guard.onNotification({
      type: "notification_accept",
      key: "long-recording:silence:s1:n",
      source: null,
    });
    expect(ctx.listener.stop).toHaveBeenCalledTimes(1);
  });

  test("pauses after 30 min of quiet and saves a pause nobody answers", async () => {
    await ctx.at(SILENCE_PAUSE_MS, 1_000);

    expect(ctx.listener.setPaused).toHaveBeenCalledWith(true);
    expect(ctx.notify).toHaveBeenLastCalledWith(
      "paused",
      "long-recording:paused:s1:n",
    );

    await ctx.at(SILENCE_PAUSE_MS, 1_000 + 2 * HOUR - 1);
    expect(ctx.listener.stop).not.toHaveBeenCalled();

    await ctx.at(SILENCE_PAUSE_MS, 1_000 + 2 * HOUR);
    expect(ctx.listener.stop).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenLastCalledWith(
      "saved",
      "long-recording:saved:s1:n",
    );
  });

  test("Resume from the notification keeps the recording going", async () => {
    await ctx.at(SILENCE_PAUSE_MS, 1_000);
    await ctx.guard.onNotification({
      type: "notification_accept",
      key: "long-recording:paused:s1:n",
      source: null,
    });

    expect(ctx.listener.setPaused).toHaveBeenLastCalledWith(false);
    await ctx.at(SILENCE_PAUSE_MS, 1_000 + 3 * HOUR);
    expect(ctx.listener.stop).not.toHaveBeenCalled();
  });

  test("a pause the user chose never ends in a stop", async () => {
    await ctx.at(5 * 60_000);
    await ctx.listener.setPaused(true);
    await ctx.at(5 * 60_000, 10 * HOUR);

    expect(ctx.listener.stop).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  test("ignores notifications for a recording that already ended", async () => {
    ctx.listener.live.status = "inactive";

    const handled = await ctx.guard.onNotification({
      type: "notification_accept",
      key: "long-recording:silence:s1:n",
      source: null,
    });

    expect(handled).toBe(true);
    expect(ctx.listener.stop).not.toHaveBeenCalled();
  });

  test("leaves other notifications alone", async () => {
    expect(
      await ctx.guard.onNotification({
        type: "notification_accept",
        key: "auto-stop-ended:s1:prompt:x",
        source: null,
      }),
    ).toBe(false);
    expect(parseLongRecordingNotificationKey("long-recording:nope:s1:n")).toBe(
      null,
    );
  });
});
