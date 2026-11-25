import { describe, expect, it } from "vitest";

import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { chineseShare, computeChineseStats, countSyllables } from "./language";
import { lessonRoles } from "./roles";

function line(
  text: string,
  startMs: number,
  endMs: number,
  human: string,
): RenderedTranscriptSegment {
  return {
    id: `${startMs}`,
    key: { channel: "DirectMic", speaker_index: null, speaker_human_id: human },
    speaker_label: human,
    start_ms: startMs,
    end_ms: endMs,
    text,
    words: [],
  };
}

describe("how much of a lesson is in Chinese", () => {
  it("counts a syllable per character and vowel groups in other words", () => {
    expect(countSyllables("我们都很好")).toEqual({ chinese: 5, other: 0 });
    expect(countSyllables("The weather, 天气.")).toEqual({
      chinese: 2,
      other: 3,
    });
    expect(countSyllables("…")).toEqual({ chinese: 0, other: 0 });
  });

  it("splits each line's time between Chinese and the rest", () => {
    const segments = [
      line("我们都很好", 0, 5_000, "teacher"),
      line("Say it again", 5_000, 8_000, "teacher"),
      line("天气 is weather", 8_000, 12_000, "me"),
    ];
    const stats = computeChineseStats(segments, lessonRoles(segments, "me"));

    // The last line: 2 Chinese syllables of 5 ("is", "wea", "ther").
    expect(stats).toEqual({
      spokenMs: 12_000,
      chineseMs: 6_600,
      studentChineseMs: 1_600,
    });
    expect(chineseShare(stats!)).toBe(55);
  });

  it("has nothing to say about a lesson with no Chinese", () => {
    expect(
      computeChineseStats([line("Hello there", 0, 2_000, "me")]),
    ).toBeNull();
  });
});
