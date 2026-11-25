import { afterEach, describe, expect, it, vi } from "vitest";

import { toggleSheetClip, trackSheetClip, useSheetClip } from "./sheet-clip";

function player(state: "playing" | "paused" | "stopped", at: number | null) {
  return {
    state,
    currentTime: () => at,
    pause: vi.fn(),
    playRange: vi.fn(),
  };
}

const clip = { key: "term:都", startSec: 10, endSec: 12 };

describe("a clip's play button", () => {
  afterEach(() => useSheetClip.setState({ active: null }));

  it("starts its clip, pauses it, then carries on from there", () => {
    const first = player("stopped", null);
    toggleSheetClip(first, clip);
    expect(first.playRange).toHaveBeenCalledWith(10, 12);

    const playing = player("playing", 10.5);
    toggleSheetClip(playing, clip);
    expect(playing.pause).toHaveBeenCalled();
    expect(playing.playRange).not.toHaveBeenCalled();

    const paused = player("paused", 11);
    toggleSheetClip(paused, clip);
    expect(paused.playRange).toHaveBeenCalledWith(11, 12);
  });

  it("starts over once the clip has ended, and switches to another clip", () => {
    useSheetClip.setState({ active: clip });
    const ended = player("paused", 12);
    toggleSheetClip(ended, clip);
    expect(ended.playRange).toHaveBeenCalledWith(10, 12);

    const other = player("playing", 11);
    toggleSheetClip(other, { key: "term:也", startSec: 30, endSec: 31 });
    expect(other.pause).not.toHaveBeenCalled();
    expect(other.playRange).toHaveBeenCalledWith(30, 31);
    expect(useSheetClip.getState().active?.key).toBe("term:也");
  });

  it("lets go of the clip when playback moves elsewhere", () => {
    useSheetClip.setState({ active: clip });
    trackSheetClip(11, true);
    expect(useSheetClip.getState().active).not.toBeNull();
    trackSheetClip(40, true);
    expect(useSheetClip.getState().active).toBeNull();
  });
});
