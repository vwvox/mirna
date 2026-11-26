import chroma from "chroma-js";
import { describe, expect, it } from "vitest";

import {
  findBackchannels,
  formatTranscriptTime,
  getActiveLineIndex,
  getSegmentColor,
  getSegmentColorVars,
  getSpeakerInitial,
  groupWordsIntoParagraphs,
  joinWordTexts,
  spaceEditedText,
  wordSeparator,
} from "./utils";

import type { Segment, SegmentKey, SegmentWord } from "~/stt/live-segment";

describe("transcript renderer utils", () => {
  it.each(["light", "dark"] as const)(
    "distinguishes people sharing a channel and speaker index in %s mode",
    (mode) => {
      const key: SegmentKey = {
        channel: "MixedCapture",
        speaker_index: null,
        speaker_human_id: "person-1",
      };
      const first = getSegmentColor(key, mode);
      const second = getSegmentColor(
        { ...key, speaker_human_id: "person-2" },
        mode,
      );

      expect(chroma.deltaE(first, second)).toBeGreaterThan(20);
      expect(
        getSegmentColor(
          { ...key, channel: "RemoteParty", speaker_index: 3 },
          mode,
        ),
      ).toBe(first);
    },
  );

  it("spaces unidentified speakers across distinct hues", () => {
    const colors = Array.from({ length: 6 }, (_, speaker_index) =>
      getSegmentColor({
        channel: "MixedCapture",
        speaker_index,
        speaker_human_id: null,
      }),
    );

    for (let index = 1; index < colors.length; index += 1) {
      expect(chroma.deltaE(colors[index - 1], colors[index])).toBeGreaterThan(
        20,
      );
    }
    expect(new Set(colors).size).toBe(6);
  });

  it("uses a brighter speaker color for dark mode", () => {
    const key: SegmentKey = {
      channel: "RemoteParty",
      speaker_index: 1,
      speaker_human_id: null,
    };

    expect(chroma(getSegmentColor(key, "dark")).luminance()).toBeGreaterThan(
      chroma(getSegmentColor(key)).luminance(),
    );
  });

  it("exposes light and dark speaker color variables", () => {
    const key: SegmentKey = {
      channel: "DirectMic",
      speaker_index: 0,
      speaker_human_id: null,
    };

    expect(getSegmentColorVars(key)).toEqual({
      "--segment-color-light": getSegmentColor(key),
      "--segment-color-dark": getSegmentColor(key, "dark"),
    });
  });

  it("finds the active transcript line without building line groups", () => {
    const words: SegmentWord[] = [
      createWord("word-1", "Hello", 100, 400),
      createWord("word-2", "world.", 400, 900),
      createWord("word-3", "Next", 1400, 1600),
      createWord("word-4", "line!", 1600, 2100),
    ];

    expect(getActiveLineIndex(words, 50, 0)).toBeNull();
    expect(getActiveLineIndex(words, 50, 149)).toBeNull();
    expect(getActiveLineIndex(words, 50, 150)).toBe(0);
    expect(getActiveLineIndex(words, 50, 950)).toBe(0);
    expect(getActiveLineIndex(words, 50, 1200)).toBeNull();
    expect(getActiveLineIndex(words, 50, 1450)).toBe(1);
    expect(getActiveLineIndex(words, 50, 2150)).toBe(1);
    expect(getActiveLineIndex(words, 50, 2200)).toBeNull();
  });
});

function createWord(
  id: string,
  text: string,
  startMs: number,
  endMs: number,
): SegmentWord {
  return {
    id,
    text,
    start_ms: startMs,
    end_ms: endMs,
    channel: "MixedCapture",
    is_final: true,
  };
}

describe("wordSeparator", () => {
  it("runs Chinese, Japanese and Korean text together", () => {
    expect(wordSeparator("两个宝子。", "巧。")).toBe("");
    expect(wordSeparator("你好", "世界")).toBe("");
    expect(wordSeparator("こんにちは", "世界")).toBe("");
  });

  it("keeps spaces around everything else", () => {
    expect(wordSeparator("right.", "两个宝子。")).toBe(" ");
    expect(wordSeparator("出差。", "Verb")).toBe(" ");
    expect(wordSeparator("hello", "world")).toBe(" ");
  });
});

describe("paragraphs", () => {
  it("starts a new paragraph after a pause of more than 1.5 s", () => {
    const words = [
      createWord("word-1", "So", 0, 200),
      createWord("word-2", "then", 200, 500),
      createWord("word-3", "we", 2000, 2200),
      createWord("word-4", "left.", 2201, 2500),
      createWord("word-5", "Done", 4001, 4300),
    ];

    expect(
      groupWordsIntoParagraphs(words).map((paragraph) =>
        paragraph.lines.map((line) => line.words.map((word) => word.text)),
      ),
    ).toEqual([[["So", "then", "we", "left."]], [["Done"]]]);
    expect(getActiveLineIndex(words, 0, 4100)).toBe(1);
    expect(getActiveLineIndex(words, 0, 3000)).toBeNull();
  });

  it("ends sentences on Chinese punctuation", () => {
    const words = [
      createWord("word-1", "你好。", 0, 400),
      createWord("word-2", "好吗？", 500, 900),
    ];

    expect(
      groupWordsIntoParagraphs(words)[0]!.lines.map(
        (line) => line.words.length,
      ),
    ).toEqual([1, 1]);
    expect(getActiveLineIndex(words, 0, 600)).toBe(1);
  });
});

describe("edited text", () => {
  it("joins Chinese words without spaces and tracks where each starts", () => {
    expect(joinWordTexts(["我们", "都", "OK", "好"])).toEqual({
      text: "我们都 OK 好",
      starts: [0, 2, 4, 7],
    });
  });

  it("leaves space-separated words as typed", () => {
    expect(spaceEditedText(["First", "line."], "First lime.", 6)).toEqual({
      text: "First lime.",
      offset: 6,
    });
  });

  it("gives Chinese edits back to the words they touch", () => {
    expect(spaceEditedText(["我们", "都", "很好。"], "我们都很号。").text).toBe(
      "我们 都 很号。",
    );
    expect(spaceEditedText(["你好", "世界"], "你世界").text).toBe("你 世界");
    expect(spaceEditedText(["我", "们", "都"], "大家都").text).toBe("大 家 都");
    expect(spaceEditedText(["你好", "世界"], "你好呀世界").text).toBe(
      "你好呀 世界",
    );
  });

  it("moves a split position to the spaced text", () => {
    expect(spaceEditedText(["你好", "世界"], "你好世界", 2)).toEqual({
      text: "你好 世界",
      offset: 2,
    });
    expect(spaceEditedText(["你好", "世界"], "你好世界", 3).offset).toBe(4);
  });
});

describe("row helpers", () => {
  it("formats positions as mm:ss, and h:mm:ss past an hour", () => {
    expect(formatTranscriptTime(0)).toBe("00:00");
    expect(formatTranscriptTime(65_400)).toBe("01:05");
    expect(formatTranscriptTime(3_725_000)).toBe("1:02:05");
  });

  it("shows a speaker's initial, or a numbered speaker's number", () => {
    expect(getSpeakerInitial("rui")).toBe("R");
    expect(getSpeakerInitial("Speaker 2")).toBe("2");
    expect(getSpeakerInitial("王老师")).toBe("王");
  });

  it("finds short replies between other people's turns", () => {
    const long = (speaker: number, start: number) =>
      createSegmentAt(speaker, start, ["one", "two", "three", "four"], 3000);
    const short = (speaker: number, start: number, words = ["Yeah."]) =>
      createSegmentAt(speaker, start, words, 600);

    expect(findBackchannels([long(0, 0), short(1, 4), long(0, 5)])).toEqual(
      new Set([1]),
    );
    expect(findBackchannels([long(0, 0), short(0, 4), long(1, 5)]).size).toBe(
      0,
    );
    expect(
      findBackchannels([long(0, 0), short(1, 4), short(0, 5), long(1, 6)]).size,
    ).toBe(0);
    expect(
      findBackchannels([
        long(0, 0),
        short(1, 4, ["Yes", "I", "think", "so."]),
        long(0, 5),
      ]).size,
    ).toBe(0);
    expect(
      findBackchannels([
        long(0, 0),
        createSegmentAt(1, 4, ["Hmm."], 1600),
        long(0, 8),
      ]).size,
    ).toBe(0);
  });
});

function createSegmentAt(
  speakerIndex: number,
  startSeconds: number,
  texts: string[],
  durationMs: number,
): Segment {
  const start = startSeconds * 1000;
  const step = durationMs / texts.length;
  return {
    id: `segment-${startSeconds}`,
    key: {
      channel: "MixedCapture",
      speaker_index: speakerIndex,
      speaker_human_id: null,
    },
    start_ms: start,
    end_ms: start + durationMs,
    text: texts.join(" "),
    words: texts.map((text, index) =>
      createWord(
        `word-${startSeconds}-${index}`,
        text,
        start + index * step,
        start + (index + 1) * step,
      ),
    ),
  };
}
