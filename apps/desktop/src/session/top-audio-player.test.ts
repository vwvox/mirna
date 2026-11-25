import { describe, expect, it } from "vitest";

import { shouldShowSessionTopAudioPlayer } from "./top-audio-player";

describe("shouldShowSessionTopAudioPlayer", () => {
  it("shows playback on the study sheet, which plays the teacher's clips", () => {
    expect(
      shouldShowSessionTopAudioPlayer({
        audioExists: true,
        audioUrlReady: true,
        currentView: { type: "lesson" },
        sessionMode: "inactive",
      }),
    ).toBe(true);
  });

  it("shows playback only on the transcript tab", () => {
    expect(
      shouldShowSessionTopAudioPlayer({
        audioExists: true,
        audioUrlReady: true,
        currentView: { type: "transcript" },
        sessionMode: "inactive",
      }),
    ).toBe(true);

    expect(
      shouldShowSessionTopAudioPlayer({
        audioExists: true,
        audioUrlReady: true,
        currentView: { type: "enhanced", id: "summary-1" },
        sessionMode: "inactive",
      }),
    ).toBe(false);
  });

  it("keeps playback hidden while recording or finalizing", () => {
    expect(
      shouldShowSessionTopAudioPlayer({
        audioExists: true,
        audioUrlReady: true,
        currentView: { type: "transcript" },
        sessionMode: "active",
      }),
    ).toBe(false);

    expect(
      shouldShowSessionTopAudioPlayer({
        audioExists: true,
        audioUrlReady: true,
        currentView: { type: "transcript" },
        sessionMode: "finalizing",
      }),
    ).toBe(false);
  });
});
