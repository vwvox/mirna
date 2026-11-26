import * as pinyinPro from "pinyin-pro";
import { describe, expect, it } from "vitest";

import { retimeEvenRuns } from "./clips";
import { smoothPitch } from "./pitch";
import { checkTones, describeShape, toneSyllables } from "./tones";

describe("tone practice", () => {
  it("reads each syllable's tone as said, with third-tone changes", () => {
    expect(
      toneSyllables("你好", pinyinPro).map((syllable) => [
        syllable.pinyin,
        syllable.tone,
        syllable.spoken,
      ]),
    ).toEqual([
      ["nǐ", 3, 2],
      ["hǎo", 3, 3],
    ]);
    expect(toneSyllables("老师", pinyinPro)[0]?.spoken).toBe("half-3");
  });

  it("tells level, rising, falling and dipping apart", () => {
    expect(describeShape([3, 3, 3.2, 3, 2.9, 3])).toBe("level");
    expect(describeShape([-1, 0, 1, 2, 3, 4])).toBe("rising");
    expect(describeShape([4, 2, 0, -2, -4, -5])).toBe("falling");
    expect(describeShape([-1, -3, -5, -5, -3, -1])).toBe("dipping");
    expect(describeShape([1, 2])).toBeNull();
  });

  it("checks each syllable, split at the pause between them", () => {
    const syllables = toneSyllables("我们", pinyinPro); // wǒ (low) then light men
    expect(syllables.map((syllable) => syllable.spoken)).toEqual(["half-3", 0]);
    const lowThenLight = [-2, -3, -4, -5, -5, null, -1, -1.2, -1.5];
    expect(
      checkTones(syllables, lowThenLight).map((result) => result.ok),
    ).toEqual([true, true]);

    const risingFirst = [-2, 0, 2, 4, 5, null, -1, -1.2, -1.5];
    const [first] = checkTones(syllables, risingFirst);
    expect(first).toMatchObject({ ok: false, heard: "rising" });
  });
});

describe("pitch clean-up", () => {
  it("pulls octave slips back and drops one-frame blips", () => {
    const smoothed = smoothPitch([200, 202, 400, 204, 206, null, 300, null]);
    expect(smoothed.slice(0, 5).every((value) => value! < 210)).toBe(true);
    expect(smoothed[6]).toBeNull();
  });
});

describe("clip timing", () => {
  it("re-times evenly spread words by their syllables, at a speaking pace", () => {
    const words = [
      { text: " Say", start_ms: 0, end_ms: 400 },
      { text: " 我们都很好。", start_ms: 400, end_ms: 800 },
      { text: " ok", start_ms: 800, end_ms: 1_200 },
    ];
    // 1 + 5 + 1 syllables, stretched to a third of a second each.
    expect(
      retimeEvenRuns(words).map((word) => [word.start_ms, word.end_ms]),
    ).toEqual([
      [0, 330],
      [330, 1_980],
      [1_980, 2_310],
    ]);
  });

  it("gives a squeezed Chinese phrase room, short of the next one", () => {
    // From a real lesson: four syllables stamped 0.4 s, the next phrase 2.3 s on.
    const words = [
      { text: " 不穿毛衣。", start_ms: 181_578, end_ms: 181_978 },
      { text: " 你今天穿。", start_ms: 183_882, end_ms: 184_282 },
    ];
    expect(retimeEvenRuns(words)[0]).toMatchObject({
      start_ms: 181_578,
      end_ms: 182_898,
    });
    const tight = [
      { text: " 不穿毛衣。", start_ms: 181_578, end_ms: 181_978 },
      { text: " 你今天穿。", start_ms: 182_300, end_ms: 182_700 },
    ];
    expect(retimeEvenRuns(tight)[0]!.end_ms).toBe(182_220);
  });

  it("leaves real word timings alone", () => {
    const words = [
      { text: "a", start_ms: 0, end_ms: 120 },
      { text: "b", start_ms: 150, end_ms: 400 },
      { text: "c", start_ms: 400, end_ms: 900 },
    ];
    expect(retimeEvenRuns(words)).toEqual(words);
  });
});
