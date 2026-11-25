import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { create } from "zustand";

import { commands as detectCommands } from "@anlg/plugin-detect";
import { Check } from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";
import { toast } from "@anlg/ui/components/ui/toast";

import { requestLessonSheet } from "../auto";
import {
  loadCourseLessons,
  loadLessonSession,
  markSessionAsLesson,
} from "../queries";
import { useMarkShortcutLabels } from "../shortcut-labels";
import { defaultLessonTitle } from "../title";

import { useLanguageModel } from "~/ai/hooks";
import { liveQueryClient } from "~/db";
import { createNamedFolder } from "~/session/folder-catalog";
import {
  createSession,
  updateSession,
  useFolderPaths,
} from "~/session/queries";
import { openSessionAndListen } from "~/shared/useNewNote";
import { useTabs } from "~/store/zustand/tabs";
import {
  CHINESE_DISPLAY_MODES,
  type ChineseDisplayMode,
  effectiveChineseDisplay,
  useChineseDisplay,
} from "~/stt/pinyin";

export const useNewLessonDialog = create<{
  open: boolean;
  folderPath: string | null;
  /** Set when an existing note is being made into a lesson, instead of a new one. */
  convertSessionId: string | null;
}>(() => ({ open: false, folderPath: null, convertSessionId: null }));

export function openNewLessonDialog(folderPath: string | null = null) {
  useNewLessonDialog.setState({
    open: true,
    folderPath,
    convertSessionId: null,
  });
}

export function openMakeLessonDialog(sessionId: string, folderPath: string) {
  useNewLessonDialog.setState({
    open: true,
    folderPath: folderPath || null,
    convertSessionId: sessionId,
  });
}

const LANGUAGES = [
  "zh",
  "en",
  "pt",
  "es",
  "fr",
  "de",
  "it",
  "ja",
  "ko",
  "ar",
  "ru",
  "nl",
  "ga",
] as const;

function languageLabel(code: string, locale: string) {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

const NEW_COURSE = "\u0000new";

type Defaults = { folderPath: string; learning: string; explainIn: string };

async function loadDefaults(): Promise<Defaults> {
  const rows = await liveQueryClient.execute<{
    id: string;
    folder_path: string;
  }>(
    `
      SELECT id, folder_path FROM sessions
      WHERE kind = 'lesson' AND deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(started_at, ''), created_at) DESC
      LIMIT 1
    `,
  );
  const last = rows[0];
  if (!last) return { folderPath: "", learning: "zh", explainIn: "en" };
  const lesson = await loadLessonSession(last.id);
  return {
    folderPath: last.folder_path,
    learning: lesson.settings?.learning ?? "zh",
    explainIn: lesson.settings?.explainIn ?? "en",
  };
}

const MIRNA_BUNDLE_PREFIX = "app.mirna";

function useCallApps(enabled: boolean) {
  return useQuery({
    queryKey: ["lesson-call-apps"],
    enabled,
    refetchInterval: enabled ? 3000 : false,
    queryFn: async () => {
      const result = await detectCommands.listMicUsingApplications();
      if (result.status === "error") return [];
      return result.data.filter(
        (app) => !app.id.startsWith(MIRNA_BUNDLE_PREFIX),
      );
    },
  });
}

export function NewLessonDialogHost() {
  const open = useNewLessonDialog((state) => state.open);
  if (!open) return null;
  return <NewLessonDialog />;
}

function NewLessonDialog() {
  const { t, i18n } = useLingui();
  const presetFolder = useNewLessonDialog((state) => state.folderPath);
  const convertId = useNewLessonDialog((state) => state.convertSessionId);
  const converting = convertId !== null;
  const folders = useFolderPaths();
  const model = useLanguageModel("enhance");
  const existing = useQuery({
    queryKey: ["lesson-existing", convertId],
    enabled: converting,
    queryFn: () => loadLessonSession(convertId!),
  });
  const defaults = useQuery({
    queryKey: ["lesson-defaults"],
    queryFn: loadDefaults,
    staleTime: 0,
  });
  const callApps = useCallApps(!converting);
  const shortcutLabels = useMarkShortcutLabels((state) => state.labels);

  const [course, setCourse] = useState<string | null>(null);
  const [newCourse, setNewCourse] = useState("");
  const [learning, setLearning] = useState<string | null>(null);
  const [explainIn, setExplainIn] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [chineseMode, setChineseMode] = useState<ChineseDisplayMode | null>(
    null,
  );
  const lessonDisplay = effectiveChineseDisplay(
    useChineseDisplay.getState(),
    true,
  );

  // Empty paths mean "no course yet"; fall through to a new one so its name field shows.
  const suggestedCourse = presetFolder || defaults.data?.folderPath || "";
  const chosenCourse = course ?? (suggestedCourse || NEW_COURSE);
  const courseOptions =
    suggestedCourse && !folders.includes(suggestedCourse)
      ? [...folders, suggestedCourse]
      : folders;
  const folderPath =
    chosenCourse === NEW_COURSE ? newCourse.trim() : chosenCourse;

  const lessonCount = useQuery({
    queryKey: ["lesson-count", folderPath],
    enabled: Boolean(folderPath),
    queryFn: async () => (await loadCourseLessons(folderPath)).length,
  });
  const suggestedTitle = defaultLessonTitle((lessonCount.data ?? 0) + 1);

  const close = () =>
    useNewLessonDialog.setState({
      open: false,
      folderPath: null,
      convertSessionId: null,
    });
  const settings = {
    learning:
      learning ??
      existing.data?.settings?.learning ??
      defaults.data?.learning ??
      "zh",
    explainIn:
      explainIn ??
      existing.data?.settings?.explainIn ??
      defaults.data?.explainIn ??
      "en",
  };

  const saveChineseDisplay = () => {
    if (settings.learning !== "zh" || !chineseMode) return;
    if (chineseMode === lessonDisplay.mode) return;
    useChineseDisplay
      .getState()
      .update({ ...lessonDisplay, mode: chineseMode });
  };

  const start = useMutation({
    mutationFn: async () => {
      if (!folderPath) throw new Error("course");
      saveChineseDisplay();
      if (chosenCourse === NEW_COURSE) await createNamedFolder(folderPath);
      if (convertId) {
        if (folderPath !== presetFolder) {
          await updateSession(convertId, { folder_id: folderPath });
        }
        await markSessionAsLesson(convertId, settings);
        void requestLessonSheet(convertId, model, { force: true });
        return convertId;
      }
      const sessionId = await createSession(
        (title ?? suggestedTitle).trim() || suggestedTitle,
        undefined,
        { folder_id: folderPath },
      );
      await markSessionAsLesson(sessionId, settings);
      return sessionId;
    },
    onSuccess: (sessionId) => {
      close();
      if (converting) {
        useTabs.getState().openCurrent({
          type: "sessions",
          id: sessionId,
          state: {
            view: { type: "lesson" },
            autoStart: false,
            scheduledAutoStart: null,
          },
        });
        return;
      }
      openSessionAndListen(sessionId);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message === "course"
          ? t`Give the course a name first.`
          : converting
            ? t`Couldn't make it a lesson.`
            : t`Couldn't start the lesson.`,
      ),
  });

  const chineseModeLabels: Record<ChineseDisplayMode, string> = {
    characters: t`Characters`,
    "pinyin-above": t`Pinyin above`,
    "word-by-word": t`Word by word`,
    "pinyin-only": t`Pinyin only`,
  };
  const apps = callApps.data ?? [];
  const appNames = apps
    .map((app) => app.name.replace(/^\u200e/, ""))
    .join(", ");
  const locale = i18n.locale || "en";

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
        <div className="flex flex-col gap-1">
          <DialogTitle className="font-brand text-2xl font-medium">
            {converting ? (
              existing.data?.isLesson ? (
                <Trans>Lesson settings</Trans>
              ) : (
                <Trans>Make this a lesson</Trans>
              )
            ) : (
              <Trans>New lesson</Trans>
            )}
          </DialogTitle>
          <DialogDescription>
            {converting ? (
              <Trans>
                Mirna writes a study sheet from this recording: words, patterns,
                corrections and homework.
              </Trans>
            ) : (
              <Trans>
                Record a class and get a study sheet afterwards: words,
                patterns, corrections and homework.
              </Trans>
            )}
          </DialogDescription>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            start.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <Trans>Course</Trans>
              <select
                className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                value={chosenCourse}
                onChange={(event) => setCourse(event.target.value)}
              >
                {courseOptions.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
                <option value={NEW_COURSE}>{t`New course…`}</option>
              </select>
            </label>
            {chosenCourse === NEW_COURSE ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <Trans>Course name</Trans>
                <input
                  autoFocus
                  value={newCourse}
                  onChange={(event) => setNewCourse(event.target.value)}
                  placeholder={t`Mandarin with my teacher`}
                  className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                />
              </label>
            ) : converting ? (
              <span />
            ) : (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <Trans>Title</Trans>
                <input
                  value={title ?? suggestedTitle}
                  onChange={(event) => setTitle(event.target.value)}
                  className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <Trans>I'm learning</Trans>
              <select
                className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                value={settings.learning}
                onChange={(event) => setLearning(event.target.value)}
              >
                {LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <Trans>Explain in</Trans>
              <select
                className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                value={settings.explainIn}
                onChange={(event) => setExplainIn(event.target.value)}
              >
                {LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code, locale)}
                  </option>
                ))}
              </select>
            </label>
            {settings.learning === "zh" ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <Trans>Show Chinese as</Trans>
                <select
                  className="bg-background h-10 rounded-lg border px-3 text-sm font-normal"
                  value={chineseMode ?? lessonDisplay.mode}
                  onChange={(event) =>
                    setChineseMode(event.target.value as ChineseDisplayMode)
                  }
                >
                  {CHINESE_DISPLAY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {chineseModeLabels[mode]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {converting ? null : (
            <>
              <div
                role="status"
                className="bg-mirna-moss/50 text-mirna-serra dark:bg-mirna-serra/30 dark:text-mirna-moss flex items-start gap-3 rounded-lg px-4 py-3 text-sm"
              >
                <Check className="mt-0.5 size-4 shrink-0" weight="bold" />
                <span>
                  {apps.length > 0 ? (
                    <Trans>
                      Sound is set up for you. Online class: the teacher comes
                      through {appNames}, and you're on the microphone.
                    </Trans>
                  ) : (
                    <Trans>
                      Sound is set up for you. No call is running, so Mirna
                      treats it as a class in the same room, on one microphone.
                    </Trans>
                  )}
                </span>
              </div>

              <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <li>
                  <kbd className="bg-muted rounded border px-1 font-mono">
                    {shortcutLabels[0]}
                  </kbd>{" "}
                  <Trans>Important</Trans>
                </li>
                <li>
                  <kbd className="bg-muted rounded border px-1 font-mono">
                    {shortcutLabels[1]}
                  </kbd>{" "}
                  <Trans>I didn't get this</Trans>
                </li>
                <li>
                  <kbd className="bg-muted rounded border px-1 font-mono">
                    {shortcutLabels[2]}
                  </kbd>{" "}
                  <Trans>Homework</Trans>
                </li>
              </ul>
            </>
          )}

          <p className="text-muted-foreground text-xs leading-relaxed">
            {converting ? (
              <Trans>
                The transcript goes to the AI picked in Intelligence, which
                writes the study sheet. The recording stays on this Mac.
              </Trans>
            ) : (
              <Trans>
                The recording stays on this Mac. After class, the transcript
                goes to the AI picked in Intelligence, which writes the study
                sheet. Let your teacher know you're recording.
              </Trans>
            )}
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={start.isPending || !folderPath}>
              {converting ? (
                <Trans>Write the study sheet</Trans>
              ) : (
                <Trans>Start lesson</Trans>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
