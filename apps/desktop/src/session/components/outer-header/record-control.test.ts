import { describe, expect, it } from "vitest";

import { liveInputProblem } from "./record-control";

const healthy = {
  micPermission: "authorized",
  systemAudioPermission: "authorized",
  mic: true,
  speaker: true,
  unavailable: false,
} as const;

describe("liveInputProblem", () => {
  it("says nothing when both inputs are allowed and capturing", () => {
    expect(liveInputProblem(healthy)).toBeNull();
  });

  it("flags Mac audio when its permission is missing, even if capture reports ready", () => {
    expect(
      liveInputProblem({ ...healthy, systemAudioPermission: "denied" }),
    ).toBe("mac-audio");
    expect(
      liveInputProblem({ ...healthy, systemAudioPermission: "neverRequested" }),
    ).toBe("mac-audio");
  });

  it("flags the microphone before Mac audio", () => {
    expect(
      liveInputProblem({
        ...healthy,
        micPermission: "denied",
        systemAudioPermission: "denied",
      }),
    ).toBe("mic");
  });

  it("flags total silence when capture is unavailable", () => {
    expect(liveInputProblem({ ...healthy, unavailable: true })).toBe("nothing");
    expect(liveInputProblem({ ...healthy, mic: false, speaker: false })).toBe(
      "nothing",
    );
  });
});
