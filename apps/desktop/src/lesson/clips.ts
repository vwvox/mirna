import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { countSyllables } from "./language";
import { type LessonRoleOf, lessonRoles } from "./roles";

export type TermOccurrence = {
  startMs: number;
  endMs: number;
  byTeacher: boolean;
};

const CLIP_LEAD_MS = 300;
const CLIP_TAIL_MS = 600;

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

type TimedWord = { text: string; start_ms: number; end_ms: number };

const HAN = /\p{Script=Han}/u;
// Teachers speak slowly and clearly; a third of a second a syllable leaves
// room for that without reaching far into the next phrase.
const MS_PER_SYLLABLE = 330;

/**
 * Engines without word timings (Qwen3-ASR for Chinese) get made-up ones: each
 * space-separated word gets 0.4 s, spread evenly over the chunk. Chinese has no
 * spaces, so "不穿毛衣。" got 0.4 s for four syllables and a clip ended
 * mid-word. Such runs (back to back, equal lengths) are re-timed by syllables,
 * and Chinese ones stretched to a speaking pace, stopping short of the next
 * word (`nextStartMs` is where the following line starts).
 */
export function retimeEvenRuns<T extends TimedWord>(
  words: T[],
  nextStartMs?: number,
): T[] {
  const result = [...words];
  let index = 0;
  while (index < words.length) {
    const first = words[index]!;
    const length = first.end_ms - first.start_ms;
    let next = index + 1;
    while (
      next < words.length &&
      Math.abs(words[next]!.start_ms - words[next - 1]!.end_ms) <= 1 &&
      Math.abs(words[next]!.end_ms - words[next]!.start_ms - length) <= 1
    ) {
      next++;
    }
    const run = words.slice(index, next);
    const weights = run.map((word) => {
      const { chinese, other } = countSyllables(word.text);
      return chinese + other;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const start = first.start_ms;
    const end = run[run.length - 1]!.end_ms;
    let stretchedEnd = end;
    if (total > 0 && run.some((word) => HAN.test(word.text))) {
      const following =
        next < words.length ? words[next]!.start_ms : nextStartMs;
      const limit =
        following !== undefined && following > end ? following - 80 : Infinity;
      stretchedEnd = Math.max(
        end,
        Math.min(start + total * MS_PER_SYLLABLE, limit),
      );
    }
    if (total > 0 && length > 0 && (run.length >= 3 || stretchedEnd > end)) {
      const span = stretchedEnd - start;
      let done = 0;
      run.forEach((word, offset) => {
        const from = start + (done / total) * span;
        done += weights[offset]!;
        result[index + offset] = {
          ...word,
          start_ms: Math.round(from),
          end_ms: Math.round(start + (done / total) * span),
        };
      });
    }
    index = next;
  }
  return result;
}

/** Every place a term was said, matched across word boundaries and punctuation. */
export function findTermOccurrences(
  segments: RenderedTranscriptSegment[],
  term: string,
  roleOf: LessonRoleOf = lessonRoles(segments, null),
): TermOccurrence[] {
  const needle = normalize(term);
  if (!needle) return [];
  const found: TermOccurrence[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    let text = "";
    const spans: { from: number; to: number; start: number; end: number }[] =
      [];
    for (const word of retimeEvenRuns(
      segment.words,
      segments[segmentIndex + 1]?.start_ms,
    )) {
      const piece = normalize(word.text);
      if (!piece) continue;
      spans.push({
        from: text.length,
        to: text.length + piece.length,
        start: word.start_ms,
        end: word.end_ms,
      });
      text += piece;
    }
    let index = text.indexOf(needle);
    while (index !== -1) {
      const until = index + needle.length;
      const covered = spans.filter(
        (span) => span.to > index && span.from < until,
      );
      if (covered.length > 0) {
        found.push({
          startMs: covered[0]!.start,
          endMs: covered[covered.length - 1]!.end,
          byTeacher: roleOf(segment) === "teacher",
        });
      }
      index = text.indexOf(needle, until);
    }
  }
  return found.sort((a, b) => a.startMs - b.startMs);
}

/**
 * The clip to play for a term: the teacher saying it, closest to when the study sheet
 * says it was taught, padded a little so the start isn't clipped.
 */
export function pickTermClip(
  occurrences: TermOccurrence[],
  aroundMs: number | null,
): { startMs: number; endMs: number } | null {
  if (occurrences.length === 0) return null;
  const teacher = occurrences.filter((occurrence) => occurrence.byTeacher);
  const pool = teacher.length > 0 ? teacher : occurrences;
  const best =
    aroundMs === null
      ? pool[0]!
      : pool.reduce((closest, occurrence) =>
          Math.abs(occurrence.startMs - aroundMs) <
          Math.abs(closest.startMs - aroundMs)
            ? occurrence
            : closest,
        );
  return {
    startMs: Math.max(0, best.startMs - CLIP_LEAD_MS),
    endMs: best.endMs + CLIP_TAIL_MS,
  };
}

type ClipRange = { startMs: number; endMs: number };

/**
 * For a correction at `atMs`: the student's line just before it and the
 * teacher's answer after, so each can be played on its own. Null when the
 * voices weren't told apart.
 */
export function correctionClips(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf,
  atMs: number,
): { you: ClipRange | null; teacher: ClipRange | null } {
  const near = segments.filter(
    (segment) =>
      segment.start_ms <= atMs + 3_000 && segment.end_ms >= atMs - 20_000,
  );
  const you = [...near]
    .reverse()
    .find(
      (segment) =>
        roleOf(segment) === "student" && segment.start_ms <= atMs + 3_000,
    );
  const from = you ? you.start_ms : atMs - 2_000;
  const teacher = segments.find(
    (segment) =>
      roleOf(segment) === "teacher" &&
      segment.start_ms >= from &&
      segment.start_ms <= atMs + 15_000 &&
      (!you || segment.start_ms >= you.end_ms - 500),
  );
  const range = (segment: RenderedTranscriptSegment | undefined) =>
    segment
      ? {
          startMs: Math.max(0, segment.start_ms - 200),
          endMs: Math.min(segment.end_ms + 300, segment.start_ms + 12_000),
        }
      : null;
  return { you: range(you), teacher: range(teacher) };
}
