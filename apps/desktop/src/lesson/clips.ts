import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

import { type LessonRoleOf, lessonRoles } from "./roles";

export type TermOccurrence = {
  startMs: number;
  endMs: number;
  byTeacher: boolean;
};

const CLIP_LEAD_MS = 250;
const CLIP_TAIL_MS = 450;

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
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
  for (const segment of segments) {
    let text = "";
    const spans: { from: number; to: number; start: number; end: number }[] =
      [];
    for (const word of segment.words) {
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
