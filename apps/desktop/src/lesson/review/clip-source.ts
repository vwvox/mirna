import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import {
  type ClipRange,
  correctionClips,
  findTermOccurrences,
  pickTermClip,
  recordingChannels,
} from "../clips";
import type { LessonRoleOf } from "../roles";

/** Where a review finds the moments it plays. */
export type ReviewClipSource = {
  /** The teacher saying a word or term, closest to when it was taught. */
  term(term: string, aroundMs: number | null): ClipRange | null;
  /** The speech from about `atMs`: a sentence, an explanation. */
  speech(atMs: number | null, maxMs?: number): ClipRange | null;
  /** The student's line before a correction and the teacher's answer. */
  correction(atMs: number | null): {
    you: ClipRange | null;
    teacher: ClipRange | null;
  };
};

/** No recording to play from. */
export const NO_CLIPS: ReviewClipSource = {
  term: () => null,
  speech: () => null,
  correction: () => ({ you: null, teacher: null }),
};

export function segmentClipSource(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf,
): ReviewClipSource {
  if (segments.length === 0) return NO_CLIPS;
  const channelOf = recordingChannels(segments);
  const endOfRecording = segments[segments.length - 1]!.end_ms;

  function speech(atMs: number | null, maxMs = 15_000): ClipRange | null {
    if (atMs === null || atMs < 0 || atMs > endOfRecording) return null;
    const near = segments.filter(
      (segment) =>
        segment.end_ms >= atMs - 500 && segment.start_ms <= atMs + 3_000,
    );
    const pick =
      near.find((segment) => roleOf(segment) === "teacher") ?? near[0];
    if (!pick) {
      return {
        startMs: Math.max(0, atMs - 500),
        endMs: Math.min(endOfRecording, atMs + Math.min(maxMs, 8_000)),
        channel: null,
      };
    }
    const startMs = Math.max(0, Math.min(pick.start_ms, atMs) - 300);
    const endMs = Math.min(
      Math.max(pick.end_ms + 400, startMs + 2_000),
      startMs + maxMs,
      endOfRecording,
    );
    return { startMs, endMs, channel: channelOf(pick) };
  }

  return {
    term(term, aroundMs) {
      const found = pickTermClip(
        findTermOccurrences(segments, term, roleOf, channelOf),
        aroundMs,
      );
      return found ?? speech(aroundMs, 4_000);
    },
    speech,
    correction(atMs) {
      return atMs === null
        ? { you: null, teacher: null }
        : correctionClips(segments, roleOf, atMs);
    },
  };
}
