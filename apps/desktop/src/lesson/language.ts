import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { type LessonRoleOf, lessonRoles } from "./roles";

export type LessonChineseStats = {
  /** Time with speech in it. */
  spokenMs: number;
  /** The part of that spent on Chinese. */
  chineseMs: number;
  /** The student's own Chinese; 0 when no voice was recognised as theirs. */
  studentChineseMs: number;
};

const HAN = /\p{Script=Han}/gu;
const WORD = /\p{L}+/gu;
const VOWELS = /[aeiouyàáâãäåèéêëìíîïòóôõöùúûüāēīōūǎěǐǒǔǖǘǚǜ]+/giu;

/**
 * Rough syllable counts, Chinese and not. Each character is one syllable; other
 * words count their vowel groups ("weather" two, "the" one). Speech runs at
 * about the same number of syllables a second in either language, so these
 * split a line's time between them.
 */
export function countSyllables(text: string): {
  chinese: number;
  other: number;
} {
  const chinese = text.match(HAN)?.length ?? 0;
  let other = 0;
  for (const word of text.replace(HAN, " ").match(WORD) ?? []) {
    other += Math.max(1, word.match(VOWELS)?.length ?? 0);
  }
  return { chinese, other };
}

/**
 * How much of the lesson was in Chinese, and how long the student spoke it.
 * Word timings in lesson transcripts are spread evenly over each line, so the
 * time is split by syllables rather than by word.
 */
export function computeChineseStats(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf = lessonRoles(segments, null),
): LessonChineseStats | null {
  let spokenMs = 0;
  let chineseMs = 0;
  let studentChineseMs = 0;
  for (const segment of segments) {
    const duration = Math.max(0, segment.end_ms - segment.start_ms);
    const { chinese, other } = countSyllables(segment.text);
    if (duration === 0 || chinese + other === 0) continue;
    const inChinese = (duration * chinese) / (chinese + other);
    spokenMs += duration;
    chineseMs += inChinese;
    if (roleOf(segment) === "student") studentChineseMs += inChinese;
  }
  if (chineseMs === 0) return null;
  return {
    spokenMs: Math.round(spokenMs),
    chineseMs: Math.round(chineseMs),
    studentChineseMs: Math.round(studentChineseMs),
  };
}

export function chineseShare(stats: LessonChineseStats): number {
  return Math.round((stats.chineseMs / stats.spokenMs) * 100);
}
