import { describe, expect, it } from "vitest";

import { createPauseClocks } from "./pause-clock";

describe("time spent paused", () => {
  it("adds up each pause of the current capture, counting one still going", () => {
    let now = 0;
    const clocks = createPauseClocks(() => now);
    clocks.observe({ sessionId: "s", paused: false });
    now = 10_000;
    clocks.observe({ sessionId: "s", paused: true });
    now = 25_000;
    clocks.observe({ sessionId: "s", paused: false });
    expect(clocks.pausedMs("s")).toBe(15_000);

    now = 40_000;
    clocks.observe({ sessionId: "s", paused: true });
    expect(clocks.pausedMs("s", 46_000)).toBe(21_000);
  });

  it("starts again for a new capture and ignores other notes", () => {
    let now = 0;
    const clocks = createPauseClocks(() => now);
    clocks.observe({ sessionId: "s", paused: true });
    now = 5_000;
    clocks.observe({ sessionId: null, paused: false });
    clocks.observe({ sessionId: "s", paused: false });
    expect(clocks.pausedMs("s")).toBe(0);
    expect(clocks.pausedMs("other")).toBe(0);
  });
});
