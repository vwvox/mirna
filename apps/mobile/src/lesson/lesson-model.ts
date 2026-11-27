// Pure helpers for lessons on the phone: the tag a recording goes to the Mac
// with, the reviews waiting to go back, and which clips stay on the phone.
// No React Native imports, so they run under node's test runner.
import type {
  CourseInfo,
  LessonTag,
  MacLesson,
  RemoteClip,
  RemoteReviewSummary,
} from "../mac-link/model.ts";
import { type ReviewRun, runScore } from "./review-plan.ts";

export type LessonSubject = LessonTag["subject"];

export const SUBJECTS: {
  subject: LessonSubject;
  label: string;
  detail: string;
}[] = [
  {
    subject: "language",
    label: "Language",
    detail: "Words, patterns and your slips",
  },
  { subject: "topic", label: "Topic", detail: "Key terms, ideas and sources" },
  {
    subject: "maths",
    label: "Maths & science",
    detail: "Formulas, worked examples and problems",
  },
];

/** The Mac's lesson settings (apps/desktop/src/lesson/types.ts). */
export type LessonSettings = {
  learning: string;
  explainIn: string;
  subject?: LessonSubject;
  subjectName?: string;
  leaveOut?: string[];
};

/**
 * What this phone said a recording it made is: a lesson (and which) or a
 * normal note, and whether the Mac has heard it yet. Kept in
 * `sessions.metadata_json.$.lesson_tag`; `at` tells one choice from the next.
 */
export type LessonTagState = {
  lesson: LessonTag | null;
  sent: boolean;
  at: string;
};

function parseJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The same rules as the Mac's `LessonTag::is_valid`. */
export function isValidTag(tag: LessonTag): boolean {
  const short = (value: string) =>
    value.trim().length > 0 && value.length <= 16;
  const course = tag.course.trim();
  return (
    course.length > 0 &&
    course.length <= 200 &&
    !/[/\\]/.test(course) &&
    SUBJECTS.some((entry) => entry.subject === tag.subject) &&
    short(tag.learning) &&
    short(tag.explain_in) &&
    (tag.subject_name ?? "").length <= 200
  );
}

/** The settings the Mac keeps for a lesson, from this phone's tag. */
export function settingsFromTag(tag: LessonTag): LessonSettings {
  const subjectName = tag.subject_name?.trim();
  return {
    learning: tag.learning,
    explainIn: tag.explain_in,
    subject: tag.subject,
    ...(subjectName ? { subjectName } : {}),
  };
}

export function parseSettings(
  text: string | null | undefined,
): LessonSettings | null {
  const value = parseJson(text) as Partial<LessonSettings> | null;
  if (
    !value ||
    typeof value.learning !== "string" ||
    typeof value.explainIn !== "string"
  ) {
    return null;
  }
  return value as LessonSettings;
}

export function parseTagState(
  text: string | null | undefined,
): LessonTagState | null {
  const value = parseJson(text) as Partial<LessonTagState> | null;
  if (!value || typeof value.at !== "string") return null;
  const lesson =
    value.lesson && typeof value.lesson.course === "string"
      ? value.lesson
      : null;
  return { lesson, sent: value.sent === true, at: value.at };
}

export function parseMacLesson(
  text: string | null | undefined,
): MacLesson | null {
  const value = parseJson(text) as Partial<MacLesson> | null;
  if (!value || typeof value.mac_session_id !== "string") return null;
  return {
    mac_session_id: value.mac_session_id,
    course: typeof value.course === "string" ? value.course : null,
    number: typeof value.number === "number" ? value.number : null,
    clips: Array.isArray(value.clips) ? value.clips : [],
    reviews: Array.isArray(value.reviews) ? value.reviews : [],
  };
}

/** The Mac's course of that name, if it has one (names match as on the Mac). */
export function findCourse(
  courses: CourseInfo[],
  name: string,
): CourseInfo | null {
  const wanted = name.trim().toLowerCase();
  return (
    courses.find((course) => course.name.trim().toLowerCase() === wanted) ??
    null
  );
}

/** A course's own settings, for a recording filed in it. */
export function tagForCourse(course: CourseInfo): LessonTag {
  const subject = SUBJECTS.some((entry) => entry.subject === course.subject)
    ? (course.subject as LessonSubject)
    : "language";
  return {
    course: course.name,
    subject,
    learning: course.learning,
    explain_in: course.explain_in,
    subject_name: course.subject_name ?? null,
  };
}

/** The number a recording becomes in its course: a new course starts at 1. */
export function nextLessonNumber(courses: CourseInfo[], name: string): number {
  return findCourse(courses, name)?.next_number ?? 1;
}

// --- Reviews played here, on their way to the Mac --------------------------

/**
 * A review played on this phone. It stays until the Mac has counted it, so
 * the lesson can say so in the meantime; `sent_at` is when the Mac took it.
 */
export type QueuedReview = {
  session_id: string;
  mac_session_id: string;
  run: ReviewRun;
  sent_at: string | null;
};

/** Reviews kept at most; the oldest go first. */
const MAX_QUEUED = 200;
/** The Mac takes at most this many in one upload. */
export const REVIEWS_PER_UPLOAD = 20;
/** How long a sent review waits for the Mac's count before it is let go. */
const SENT_KEPT_MS = 14 * 24 * 60 * 60_000;

export function queueReview(
  outbox: QueuedReview[],
  entry: QueuedReview,
): QueuedReview[] {
  return [
    ...outbox.filter((queued) => queued.run.id !== entry.run.id),
    entry,
  ].slice(-MAX_QUEUED);
}

/** Reviews still to send, by the Mac's note, a Mac-sized upload at a time. */
export function reviewBatches(
  outbox: QueuedReview[],
): { mac_session_id: string; entries: QueuedReview[] }[] {
  const batches: { mac_session_id: string; entries: QueuedReview[] }[] = [];
  for (const entry of outbox) {
    if (entry.sent_at) continue;
    const batch = batches.find(
      (candidate) =>
        candidate.mac_session_id === entry.mac_session_id &&
        candidate.entries.length < REVIEWS_PER_UPLOAD,
    );
    if (batch) batch.entries.push(entry);
    else
      batches.push({ mac_session_id: entry.mac_session_id, entries: [entry] });
  }
  return batches;
}

/**
 * The outbox after an upload: taken ones are marked sent, dropped ones go,
 * and sent ones the Mac has counted (or that waited too long) are let go.
 */
export function afterUpload(
  outbox: QueuedReview[],
  {
    accepted,
    dropped,
    counted,
    now,
  }: {
    accepted: Iterable<string>;
    dropped: Iterable<string>;
    /** Review ids the Mac has counted, as its notes say. */
    counted: Iterable<string>;
    now: Date;
  },
): QueuedReview[] {
  const taken = new Set(accepted);
  const gone = new Set(dropped);
  const done = new Set(counted);
  const at = now.toISOString();
  return outbox
    .filter((entry) => !gone.has(entry.run.id))
    .map((entry) =>
      taken.has(entry.run.id) && !entry.sent_at
        ? { ...entry, sent_at: at }
        : entry,
    )
    .filter((entry) => {
      if (done.has(entry.run.id)) return false;
      if (!entry.sent_at) return true;
      return now.getTime() - new Date(entry.sent_at).getTime() < SENT_KEPT_MS;
    });
}

export type LastReview = {
  endedAt: string;
  device: string;
  right: number;
  total: number;
  /** "phone" until the Mac has counted it: waiting to go, or sent. */
  state: "counted" | "waiting" | "sent";
};

/** The latest review of a lesson: counted by the Mac, or played here since. */
export function lastReview(
  macReviews: RemoteReviewSummary[],
  queued: QueuedReview[],
): LastReview | null {
  const counted = new Set(macReviews.map((review) => review.id));
  const all: LastReview[] = [
    ...macReviews.map((review) => ({
      endedAt: review.ended_at,
      device: review.device,
      right: review.right,
      total: review.total,
      state: "counted" as const,
    })),
    ...queued
      .filter((entry) => !counted.has(entry.run.id))
      .map((entry) => ({
        endedAt: entry.run.endedAt,
        device: "phone",
        ...runScore(entry.run.results),
        state: entry.sent_at ? ("sent" as const) : ("waiting" as const),
      })),
  ];
  let latest: LastReview | null = null;
  for (const review of all) {
    if (!latest || review.endedAt > latest.endedAt) latest = review;
  }
  return latest;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "today 08:12", "yesterday 21:10", "Tuesday 21:10", "25 Nov", in local time. */
export function whenLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${time}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Last: today 08:12 on the phone · 5 of 6 right". */
export function describeLastReview(
  review: LastReview,
  now = new Date(),
): string {
  const where = review.device === "phone" ? "on the phone" : "on the Mac";
  return `Last: ${whenLabel(review.endedAt, now)} ${where} · ${review.right} of ${review.total} right`;
}

// --- Teacher clips kept on this phone ---------------------------------------

/** Lessons whose clips stay on the phone, newest first. */
export const LESSONS_WITH_CLIPS = 10;

export type LessonClips = {
  session_id: string;
  created_at: string;
  clips: RemoteClip[];
};

/**
 * What to fetch and what to clear: every clip of the newest lessons that
 * isn't here yet, the files no plan plays any more, and the clips of older
 * lessons. `present` lists the clip files each lesson has now, by name.
 */
export function clipChanges(
  lessons: LessonClips[],
  present: Map<string, string[]>,
  limit = LESSONS_WITH_CLIPS,
): {
  download: { session_id: string; clip: RemoteClip }[];
  removeFiles: { session_id: string; name: string }[];
  clearLessons: string[];
} {
  const newest = [...lessons].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const download: { session_id: string; clip: RemoteClip }[] = [];
  const removeFiles: { session_id: string; name: string }[] = [];
  const clearLessons: string[] = [];
  newest.forEach((lesson, index) => {
    const files = present.get(lesson.session_id) ?? [];
    if (index >= limit) {
      if (files.length > 0) clearLessons.push(lesson.session_id);
      return;
    }
    const wanted = new Set(lesson.clips.map((clip) => `${clip.id}.mp3`));
    for (const clip of lesson.clips) {
      if (!files.includes(`${clip.id}.mp3`)) {
        download.push({ session_id: lesson.session_id, clip });
      }
    }
    for (const name of files) {
      if (!wanted.has(name)) {
        removeFiles.push({ session_id: lesson.session_id, name });
      }
    }
  });
  return { download, removeFiles, clearLessons };
}
