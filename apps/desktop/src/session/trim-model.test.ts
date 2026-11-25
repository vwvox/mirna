import { describe, expect, it } from "vitest";

import {
  clampKeep,
  formatClock,
  lastWordEndMs,
  lengthParts,
  suggestKeep,
  trimBlocker,
  trimChoices,
  waveformBars,
} from "./trim-model";

const MIN = 60_000;

describe("quick cuts", () => {
  it("offers only the cuts that leave enough of the recording", () => {
    expect(trimChoices(20 * MIN).map((choice) => choice.minutes)).toEqual([
      5, 10, 15,
    ]);
    expect(trimChoices(20 * MIN)[0]).toEqual({ minutes: 5, keepMs: 15 * MIN });
    expect(trimChoices(4 * MIN)).toEqual([]);
    expect(trimChoices(125 * MIN)).toHaveLength(5);
  });

  it("keeps 30 s after a cut that leaves exactly the minimum", () => {
    expect(
      trimChoices(5 * MIN + 30_000).map((choice) => choice.keepMs),
    ).toEqual([30_000]);
    expect(trimChoices(5 * MIN + 29_999)).toEqual([]);
  });
});

describe("clamping the cut", () => {
  it("keeps at least 30 s and never more than the recording", () => {
    expect(clampKeep(5_000, 10 * MIN)).toBe(30_000);
    expect(clampKeep(20 * MIN, 10 * MIN)).toBe(10 * MIN);
    expect(clampKeep(61_499, 10 * MIN)).toBe(61_000);
    expect(clampKeep(5_000, 20_000)).toBe(20_000);
  });
});

describe("suggested end", () => {
  it("finds when the last word ends, in any order", () => {
    expect(
      lastWordEndMs([
        { end_ms: 4_000 },
        { end_ms: 9_500 },
        { end_ms: 7_000 },
        { end_ms: Number.NaN },
      ]),
    ).toBe(9_500);
    expect(lastWordEndMs([])).toBeNull();
  });

  it("ends 30 s after the talking when a long quiet follows", () => {
    expect(suggestKeep(50 * MIN, 90 * MIN)).toEqual({
      talkEndsMs: 50 * MIN,
      keepMs: 50 * MIN + 30_000,
    });
  });

  it("rounds the suggestion to the second", () => {
    expect(suggestKeep(20 * MIN + 1_400, 60 * MIN)?.keepMs).toBe(
      20 * MIN + 31_000,
    );
  });

  it("suggests nothing when the talking goes on to near the end", () => {
    expect(suggestKeep(58 * MIN, 60 * MIN)).toBeNull();
    expect(suggestKeep(57 * MIN, 60 * MIN)).not.toBeNull();
  });

  it("suggests nothing without words or for a very short recording", () => {
    expect(suggestKeep(null, 60 * MIN)).toBeNull();
    expect(suggestKeep(0, 30_000)).toBeNull();
  });

  it("never suggests keeping less than 30 s", () => {
    expect(suggestKeep(1_000, 10 * MIN)?.keepMs).toBe(31_000);
    expect(suggestKeep(0, 10 * MIN)?.keepMs).toBe(30_000);
  });
});

describe("what keeps a recording from being trimmed here", () => {
  const ok = { lengthMs: 10 * MIN, transcriptCount: 1, fromPhone: false };

  it("allows a single recording made on this Mac", () => {
    expect(trimBlocker(ok)).toBeNull();
    expect(trimBlocker({ ...ok, transcriptCount: 0 })).toBeNull();
  });

  it("refuses a note recorded in several parts", () => {
    expect(trimBlocker({ ...ok, transcriptCount: 2 })).toBe("several_parts");
    expect(trimBlocker({ ...ok, transcriptCount: 2, fromPhone: true })).toBe(
      "several_parts",
    );
  });

  it("leaves a phone's recording to the phone", () => {
    expect(trimBlocker({ ...ok, fromPhone: true })).toBe("from_phone");
  });

  it("refuses a recording with nothing to cut past the minimum", () => {
    expect(trimBlocker({ ...ok, lengthMs: 30_500 })).toBe("too_short");
    expect(trimBlocker({ ...ok, lengthMs: 31_000 })).toBeNull();
  });
});

describe("waveform bars", () => {
  it("merges channels and keeps the loudest moment in each bar", () => {
    const bars = waveformBars(
      [
        [0.1, 0.2, 0, 0],
        [0, 0, 0, 0.8],
      ],
      2,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toBeCloseTo(Math.sqrt(0.2 / 0.8));
    expect(bars[1]).toBe(1);
  });

  it("never draws a bar flatter than a sliver", () => {
    expect(waveformBars([[0, 0, 0, 1]], 4)).toEqual([0.06, 0.06, 0.06, 1]);
  });

  it("draws nothing without peaks", () => {
    expect(waveformBars([], 10)).toEqual([]);
    expect(waveformBars([[]], 10)).toEqual([]);
  });

  it("copes with fewer peaks than bars", () => {
    const bars = waveformBars([[0.5, 1]], 4);
    expect(bars).toHaveLength(4);
    expect(bars.every((height) => height >= 0.06 && height <= 1)).toBe(true);
  });
});

describe("lengths and cut points", () => {
  it("splits lengths for display", () => {
    expect(lengthParts(45_000)).toEqual({ seconds: 45 });
    expect(lengthParts(12 * MIN)).toEqual({ hours: 0, minutes: 12 });
    expect(lengthParts(62 * MIN + 20_000)).toEqual({ hours: 1, minutes: 2 });
  });

  it("formats cut points as a clock", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(0)).toBe("0:00");
  });
});
