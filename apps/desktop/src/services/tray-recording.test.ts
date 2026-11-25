import { describe, expect, test, vi } from "vitest";

import {
  createTrayRecordingTitlePublisher,
  handleTrayRecordingAction,
  getTrayRecordingSessionId,
  getTrayRecordingTitle,
} from "./tray-recording";

import { resolveLiveSessionTitle } from "~/store/zustand/live-title";

describe("createTrayRecordingTitlePublisher", () => {
  test("publishes title changes in order", async () => {
    let resolveFirst: (() => void) | undefined;
    const published: Array<string | null> = [];
    const publish = createTrayRecordingTitlePublisher(
      (title) =>
        new Promise<void>((resolve) => {
          published.push(title);
          if (title === "First") {
            resolveFirst = resolve;
          } else {
            resolve();
          }
        }),
    );

    const first = publish("First");
    const second = publish("Second");

    await Promise.resolve();
    expect(published).toEqual(["First"]);

    resolveFirst?.();
    await Promise.all([first, second]);

    expect(published).toEqual(["First", "Second"]);
  });
});

describe("getTrayRecordingSessionId", () => {
  test.each([
    ["active", "session-1"],
    ["finalizing", "session-1"],
    ["inactive", ""],
  ] as const)("while %s returns %j", (status, expected) => {
    expect(getTrayRecordingSessionId(status, "session-1")).toBe(expected);
  });
});

describe("getTrayRecordingTitle", () => {
  test.each([
    ["  Customer call  ", "Customer call"],
    [undefined, null],
    ["  ", null],
    ["Untitled", null],
    ["Untitled event", null],
  ])("maps %j to %j", (title, expected) => {
    expect(getTrayRecordingTitle(title)).toBe(expected);
  });
});

describe("resolveLiveSessionTitle", () => {
  test.each([
    [
      "keeps a persisted optimistic title until the live query catches up",
      Date.now(),
      "Untitled",
      "Customer call",
    ],
    [
      "uses a newer store title after the optimistic write is acknowledged",
      Date.now(),
      "Customer follow-up",
      "Customer follow-up",
    ],
    [
      "drops an unacknowledged optimistic title after the live-query window",
      0,
      "Untitled",
      "Untitled",
    ],
  ])("%s", (_name, persistedAt, storeTitle, expected) => {
    expect(
      resolveLiveSessionTitle(
        {
          value: "Customer call",
          persisted: true,
          persistedAt,
          previousTitle: "Untitled",
        },
        storeTitle,
      ),
    ).toBe(expected);
  });
});

describe("handleTrayRecordingAction", () => {
  const listener = (status: "active" | "inactive" | "finalizing") => ({
    live: { status } as never,
    stop: vi.fn(),
    setPaused: vi.fn(async () => true),
  });

  test("pauses, resumes and stops the active recording", async () => {
    const active = listener("active");

    await handleTrayRecordingAction("pause", active);
    await handleTrayRecordingAction("resume", active);
    await handleTrayRecordingAction("stop", active);

    expect(active.setPaused.mock.calls).toEqual([[true], [false]]);
    expect(active.stop).toHaveBeenCalledTimes(1);
  });

  test("does nothing once the recording has stopped", async () => {
    const finalizing = listener("finalizing");

    await handleTrayRecordingAction("pause", finalizing);
    await handleTrayRecordingAction("stop", finalizing);

    expect(finalizing.setPaused).not.toHaveBeenCalled();
    expect(finalizing.stop).not.toHaveBeenCalled();
  });
});
