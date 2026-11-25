import { t } from "@lingui/core/macro";

/** The name a lesson started from "Start lesson" gets, such as "Lesson 5". */
export function defaultLessonTitle(number: number): string {
  return t`Lesson ${number}`;
}

/**
 * "Lesson 5" becomes "Lesson 5 · 都 and the weather" once the study sheet names
 * the topic. A title the student or the summary gave stays as it is (null).
 */
export function titleWithTopic(title: string, topic: string): string | null {
  const current = title.trim();
  const named = topic.trim();
  const number = current.match(/\d+/)?.[0];
  if (!named || !number) return null;
  if (current !== defaultLessonTitle(Number(number))) return null;
  return `${current} · ${named}`;
}
