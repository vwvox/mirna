import { describe, expect, it } from "vitest";

import type {
  ChannelProfile,
  RenderedTranscriptSegment,
} from "@anlg/plugin-transcription";

import { findTermOccurrences } from "./clips";
import { computeTalkStats, formatLessonTranscript } from "./generate";
import { lessonRoles } from "./roles";

const ME = "me";
const TEACHER = "yan";

function said(
  text: string,
  startMs: number,
  endMs: number,
  key: {
    channel?: ChannelProfile;
    index?: number;
    human?: string;
    label?: string;
  },
): RenderedTranscriptSegment {
  const channel = key.channel ?? "DirectMic";
  return {
    id: `${startMs}`,
    key: {
      channel,
      speaker_index: key.index ?? null,
      speaker_human_id: key.human ?? null,
    },
    speaker_label: key.label ?? "Speaker 1",
    start_ms: startMs,
    end_ms: endMs,
    text,
    words: [
      {
        text,
        start_ms: startMs,
        end_ms: endMs,
        channel,
        is_final: true,
      } as RenderedTranscriptSegment["words"][number],
    ],
  };
}

describe("who is the student and who the teacher", () => {
  it("goes by channel for a call recorded on the Mac", () => {
    const segments = [
      said("都好吃", 0, 3_000, { channel: "RemoteParty", human: TEACHER }),
      said("都好吃", 3_000, 4_000, { channel: "DirectMic" }),
    ];
    expect(computeTalkStats(segments, lessonRoles(segments, ME))).toEqual({
      studentMs: 1_000,
      teacherMs: 3_000,
    });
  });

  it("goes by recognised voices on a phone recording, all on one channel", () => {
    const segments = [
      said("我们都很好", 0, 6_000, { index: 0, human: TEACHER }),
      said("我们都很好", 6_000, 8_000, { index: 1, human: ME }),
      said("对", 8_000, 9_000, { index: 0 }),
      said("嗯", 9_000, 9_500, { index: 2, label: "Speaker 3" }),
    ];
    const roleOf = lessonRoles(segments, ME);

    expect(computeTalkStats(segments, roleOf)).toEqual({
      studentMs: 2_000,
      teacherMs: 7_000,
    });
    expect(formatLessonTranscript(segments, roleOf)).toBe(
      [
        "[00:00] Teacher: 我们都很好",
        "[00:06] Student: 我们都很好",
        "[00:08] Teacher: 对",
        "[00:09] Speaker 3: 嗯",
      ].join("\n"),
    );
    expect(
      findTermOccurrences(segments, "我们", roleOf).map(
        (occurrence) => occurrence.byTeacher,
      ),
    ).toEqual([true, false]);
  });

  it("counts the unrecognised voices as the teacher when only the student is known", () => {
    const segments = [
      said("a", 0, 1_000, { index: 0, human: ME }),
      said("b", 1_000, 4_000, { index: 1, label: "Speaker 2" }),
    ];
    expect(computeTalkStats(segments, lessonRoles(segments, ME))).toEqual({
      studentMs: 1_000,
      teacherMs: 3_000,
    });
  });

  it("doesn't count everything as the student when no voice was recognised", () => {
    const segments = [
      said("a", 0, 5_000, { index: 0 }),
      said("b", 5_000, 6_000, { index: 1, label: "Speaker 2" }),
    ];
    const roleOf = lessonRoles(segments, ME);
    expect(computeTalkStats(segments, roleOf)).toBeNull();
    expect(formatLessonTranscript(segments, roleOf)).toBe(
      "[00:00] Speaker 1: a\n[00:05] Speaker 2: b",
    );
  });
});
