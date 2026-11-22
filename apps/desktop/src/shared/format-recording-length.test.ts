import { describe, expect, it } from "vitest";

import { formatRecordingLength } from "./format-recording-length";

describe("formatRecordingLength", () => {
  it("formats minutes and seconds, adding hours only when needed", () => {
    expect(formatRecordingLength(12_000)).toBe("0:12");
    expect(formatRecordingLength(205_400)).toBe("3:25");
    expect(formatRecordingLength(3_729_000)).toBe("1:02:09");
    expect(formatRecordingLength(-5)).toBe("0:00");
  });
});
