import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";

import {
  commands as shortcutCommands,
  events as shortcutEvents,
} from "@anlg/plugin-shortcut";
import { toast } from "@anlg/ui/components/ui/toast";

import { addLessonMark } from "../marks";
import { useLessonSession } from "../queries";
import { MARK_SHORTCUT_SETS, useMarkShortcutLabels } from "../shortcut-labels";
import { formatClock } from "../time";
import { LESSON_MARK_KINDS } from "../types";
import { NewLessonDialogHost } from "./new-lesson-dialog";
import { useMarkLabels } from "./study-sheet";

import { useListener } from "~/stt/contexts";

export function LessonServices() {
  return (
    <>
      <NewLessonDialogHost />
      <LessonMarkShortcuts />
    </>
  );
}

let registration: Promise<unknown> = Promise.resolve();

/** Registration and release run one after the other, so a quick stop can't leave keys taken. */
function serially(task: () => Promise<unknown>) {
  registration = registration.then(task, task);
  return registration;
}

/**
 * ⌥1, ⌥2 and ⌥3 (or ⌃⌥) mark the moment, system-wide, but only while a lesson is recording,
 * so the keys are free the rest of the time.
 */
function LessonMarkShortcuts() {
  const { t } = useLingui();
  const labels = useMarkLabels();
  const liveSessionId = useListener((state) =>
    state.live.status === "active" ? state.live.sessionId : null,
  );
  const isLesson = useLessonSession(liveSessionId).isLesson;
  const sessionId = liveSessionId && isLesson ? liveSessionId : null;

  useEffect(() => {
    if (!sessionId) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    void serially(async () => {
      let registered = false;
      for (const set of MARK_SHORTCUT_SETS) {
        const result = await shortcutCommands.registerMarkShortcuts([
          ...set.keys,
        ]);
        if (result.status === "ok") {
          useMarkShortcutLabels.setState({ labels: set.labels });
          registered = true;
          break;
        }
      }
      if (!registered) {
        toast.warning(
          t`The lesson shortcuts are taken by another app. Use the buttons instead.`,
        );
        return;
      }
      const stop = await shortcutEvents.markShortcut.listen(({ payload }) => {
        const kind = LESSON_MARK_KINDS[payload.index];
        if (!kind) return;
        void addLessonMark(sessionId, kind).then((mark) => {
          if (mark)
            toast.success(
              t`${labels[kind]} · marked at ${formatClock(mark.atMs)}`,
            );
        });
      });
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
      void serially(() => shortcutCommands.unregisterMarkShortcuts());
    };
    // Labels and t change with the language only; keep the keys registered across that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return null;
}
