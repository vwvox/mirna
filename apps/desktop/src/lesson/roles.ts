import type { RenderedTranscriptSegment } from "@anlg/plugin-transcription";

export type LessonRole = "student" | "teacher";
export type LessonRoleOf = (
  segment: RenderedTranscriptSegment,
) => LessonRole | null;

/**
 * Who is speaking in a lesson recording. A call recorded on the Mac keeps the
 * student's mic and the teacher's audio on separate channels; a phone or an
 * in-room class has one channel, so the voices the transcript recognised
 * decide instead. The note's owner is the student. When only one side was
 * recognised the rest is the other side; when nobody was, it stays unknown
 * rather than counting everything as the student.
 */
export function lessonRoles(
  segments: readonly RenderedTranscriptSegment[],
  studentHumanId: string | null | undefined,
): LessonRoleOf {
  const channels = new Set(segments.map((segment) => segment.key.channel));
  const separateChannels =
    channels.has("DirectMic") && channels.has("RemoteParty");

  const humanOfIndex = new Map<number, string>();
  for (const segment of segments) {
    const { speaker_index: index, speaker_human_id: human } = segment.key;
    if (index != null && human) humanOfIndex.set(index, human);
  }
  const humanOf = (segment: RenderedTranscriptSegment) =>
    segment.key.speaker_human_id ??
    (segment.key.speaker_index != null
      ? humanOfIndex.get(segment.key.speaker_index)
      : undefined);
  const roleOfHuman = (human: string): LessonRole | null =>
    studentHumanId ? (human === studentHumanId ? "student" : "teacher") : null;

  let knowsStudent = false;
  let knowsTeacher = false;
  for (const segment of segments) {
    const human = humanOf(segment);
    const role = human ? roleOfHuman(human) : null;
    if (role === "student") knowsStudent = true;
    if (role === "teacher") knowsTeacher = true;
  }
  const unrecognised: LessonRole | null =
    knowsStudent && !knowsTeacher
      ? "teacher"
      : knowsTeacher && !knowsStudent
        ? "student"
        : null;

  return (segment) => {
    if (separateChannels) {
      if (segment.key.channel === "DirectMic") return "student";
      if (segment.key.channel === "RemoteParty") return "teacher";
    }
    const human = humanOf(segment);
    if (human) return roleOfHuman(human);
    return unrecognised;
  };
}
