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
import { cn } from "@anlg/utils";

import { requestLessonSheet } from "../auto";
import { baseLanguageCode, LESSON_LANGUAGES } from "../languages";
import {
  loadCourseLessons,
  loadCourseSettings,
  loadLessonSession,
  markSessionAsLesson,
} from "../queries";
import { lessonSubject } from "../schema";
import { useMarkShortcutLabels } from "../shortcut-labels";
import { defaultLessonTitle } from "../title";
import type { LessonSettings, LessonSubject, SubjectSection } from "../types";
import { TranscriptionLine } from "./transcription-line";

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

type Defaults = { folderPath: string; settings: LessonSettings | null };

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
  if (!last) return { folderPath: "", settings: null };
  const lesson = await loadLessonSession(last.id);
  return { folderPath: last.folder_path, settings: lesson.settings };
}

/** The app's language when it's one lessons offer, else English. */
function appLanguage(locale: string): string {
  const base = baseLanguageCode(locale);
  return (LESSON_LANGUAGES as readonly string[]).includes(base) ? base : "en";
}

/** The ticks under "Write up after class" for each kind of class. */
const SECTIONS_FOR: Record<
  Exclude<LessonSubject, "language">,
  SubjectSection[]
> = {
  topic: ["keyTerms", "ideas", "sources", "methods", "checkYourself"],
  maths: ["formulas", "workedExamples", "slips", "problems", "keyTerms"],
};

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
  const [subject, setSubject] = useState<LessonSubject | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [learning, setLearning] = useState<string | null>(null);
  const [explainIn, setExplainIn] = useState<string | null>(null);
  const [leaveOut, setLeaveOut] = useState<SubjectSection[] | null>(null);
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
  // A course keeps its kind of class and languages from one lesson to the next.
  const courseSettings = useQuery({
    queryKey: ["lesson-course-settings", folderPath],
    enabled: Boolean(folderPath) && chosenCourse !== NEW_COURSE,
    queryFn: () => loadCourseSettings(folderPath),
  });
  const suggestedTitle = defaultLessonTitle((lessonCount.data ?? 0) + 1);

  const close = () =>
    useNewLessonDialog.setState({
      open: false,
      folderPath: null,
      convertSessionId: null,
    });
  const known =
    existing.data?.settings ??
    (chosenCourse === NEW_COURSE ? null : courseSettings.data) ??
    defaults.data?.settings ??
    null;
  const locale = i18n.locale || "en";
  const kind = subject ?? known?.subject ?? "language";
  const isLanguage = kind === "language";
  const chosenLearning =
    learning ??
    (isLanguage
      ? known && lessonSubject(known) === "language"
        ? known.learning
        : ""
      : known && lessonSubject(known) !== "language"
        ? known.learning
        : (known?.explainIn ?? appLanguage(locale)));
  const chosenExplainIn = isLanguage
    ? (explainIn ?? known?.explainIn ?? appLanguage(locale))
    : chosenLearning;
  const chosenSubjectName = (
    subjectName ??
    (known && lessonSubject(known) === kind ? known.subjectName : "") ??
    ""
  ).trim();
  const sectionsOff =
    leaveOut ??
    (known && lessonSubject(known) === kind ? (known.leaveOut ?? []) : []);

  const settings: LessonSettings = isLanguage
    ? { learning: chosenLearning, explainIn: chosenExplainIn }
    : {
        learning: chosenLearning,
        explainIn: chosenLearning,
        subject: kind,
        ...(chosenSubjectName ? { subjectName: chosenSubjectName } : {}),
        ...(sectionsOff.length
          ? {
              leaveOut: sectionsOff.filter((section) =>
                SECTIONS_FOR[kind].includes(section),
              ),
            }
          : {}),
      };

  const saveChineseDisplay = () => {
    if (!isLanguage || settings.learning !== "zh" || !chineseMode) return;
    if (chineseMode === lessonDisplay.mode) return;
    useChineseDisplay
      .getState()
      .update({ ...lessonDisplay, mode: chineseMode });
  };

  const start = useMutation({
    mutationFn: async () => {
      if (!folderPath) throw new Error("course");
      if (!settings.learning) throw new Error("language");
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
          : error instanceof Error && error.message === "language"
            ? t`Pick the language first.`
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
  const kinds: {
    value: LessonSubject;
    name: string;
    what: string;
    for: string;
  }[] = [
    {
      value: "language",
      name: t`Language`,
      what: t`Words, patterns, corrections`,
      for: t`Spanish, Japanese, Mandarin…`,
    },
    {
      value: "topic",
      name: t`Topic`,
      what: t`Key terms, ideas, people and cases`,
      for: t`Sociology, law, cooking…`,
    },
    {
      value: "maths",
      name: t`Maths & science`,
      what: t`Formulas, worked examples, problems`,
      for: t`Statistics, physics…`,
    },
  ];
  const sectionLabels: Record<SubjectSection, [string, string]> = {
    keyTerms: [t`Key terms`, t`Each in the teacher's words`],
    ideas: [t`Main ideas`, t`With the example used in class`],
    sources: [t`People, cases and sources`, t`Who and what was cited, and why`],
    methods: [t`Steps and methods`, t`When the class walks through one`],
    checkYourself: [t`Check-yourself questions`, t`Answered from the class`],
    formulas: [t`Formulas`, t`With what each symbol means`],
    workedExamples: [t`Worked examples`, t`Step by step, as done in class`],
    slips: [t`Common slips`, t`Where you or the class went wrong`],
    problems: [t`Practice problems`, t`From class and the homework`],
  };
  const apps = callApps.data ?? [];
  const appNames = apps.map((app) => app.name.replace(/^‎/, "")).join(", ");
  const field = "flex flex-col gap-1.5 text-sm font-medium";
  const select =
    "bg-background h-10 rounded-lg border px-3 text-sm font-normal";

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
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
                Mirna writes a study sheet from this recording, shaped by the
                kind of class.
              </Trans>
            ) : (
              <Trans>
                Record a class and get a study sheet afterwards, shaped by the
                kind of class.
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
          <fieldset className="flex flex-col gap-2">
            <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              <Trans>What kind of class?</Trans>
            </legend>
            <div
              role="radiogroup"
              aria-label={t`Kind of class`}
              className="grid gap-2 sm:grid-cols-3"
            >
              {kinds.map((option) => {
                const on = kind === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setSubject(option.value);
                      setLearning(null);
                      setLeaveOut(null);
                    }}
                    className={cn([
                      "flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left",
                      on
                        ? "border-mirna-serra bg-mirna-moss/40 dark:bg-mirna-serra/20 ring-mirna-serra ring-1"
                        : "hover:bg-accent",
                    ])}
                  >
                    <b className="text-sm">{option.name}</b>
                    <span className="text-xs leading-snug">{option.what}</span>
                    <span className="text-muted-foreground text-[11px]">
                      {option.for}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>
              <Trans>Course</Trans>
              <select
                className={select}
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
              <label className={field}>
                <Trans>Course name</Trans>
                <input
                  autoFocus
                  value={newCourse}
                  onChange={(event) => setNewCourse(event.target.value)}
                  placeholder={
                    kind === "language"
                      ? t`Mandarin with my teacher`
                      : kind === "maths"
                        ? t`Statistics 101`
                        : t`Law evening class`
                  }
                  className={select}
                />
              </label>
            ) : converting ? (
              <span />
            ) : (
              <label className={field}>
                <Trans>Title</Trans>
                <input
                  value={title ?? suggestedTitle}
                  onChange={(event) => setTitle(event.target.value)}
                  className={select}
                />
              </label>
            )}
            {isLanguage ? (
              <>
                <label className={field}>
                  <Trans>I'm learning</Trans>
                  <select
                    className={select}
                    value={settings.learning}
                    onChange={(event) => setLearning(event.target.value)}
                  >
                    {settings.learning ? null : (
                      <option value="" disabled>
                        {t`Pick a language`}
                      </option>
                    )}
                    {LESSON_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {languageLabel(code, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={field}>
                  <Trans>Explain in</Trans>
                  <select
                    className={select}
                    value={settings.explainIn}
                    onChange={(event) => setExplainIn(event.target.value)}
                  >
                    {LESSON_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {languageLabel(code, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                {settings.learning === "zh" ? (
                  <label className={field}>
                    <Trans>Show Chinese as</Trans>
                    <select
                      className={select}
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
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={field}>
                    <Trans>Subject</Trans>
                    <input
                      value={subjectName ?? chosenSubjectName}
                      onChange={(event) => setSubjectName(event.target.value)}
                      placeholder={
                        kind === "maths" ? t`Statistics` : t`Contract law`
                      }
                      className={select}
                    />
                  </label>
                  <span className="text-muted-foreground text-xs">
                    <Trans>Tells the AI what to look for.</Trans>
                  </span>
                </div>
                <label className={field}>
                  <Trans>Class is in</Trans>
                  <select
                    className={select}
                    value={settings.learning}
                    onChange={(event) => setLearning(event.target.value)}
                  >
                    {LESSON_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {languageLabel(code, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          {converting || !settings.learning ? null : (
            <TranscriptionLine
              languages={[settings.learning, settings.explainIn]}
            />
          )}

          {isLanguage ? null : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                <Trans>Write up after class</Trans>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECTIONS_FOR[kind].map((section) => {
                  const [name, hint] = sectionLabels[section];
                  return (
                    <label
                      key={section}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm font-semibold"
                    >
                      <input
                        type="checkbox"
                        className="accent-mirna-serra mt-0.5 size-4"
                        checked={!sectionsOff.includes(section)}
                        onChange={(event) =>
                          setLeaveOut(
                            event.target.checked
                              ? sectionsOff.filter((item) => item !== section)
                              : [...sectionsOff, section],
                          )
                        }
                      />
                      <span>
                        {name}
                        <small className="text-muted-foreground block text-xs font-normal">
                          {hint}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
              {kind === "maths" ? (
                <p className="bg-muted/60 rounded-lg px-3 py-2 text-xs leading-relaxed">
                  <Trans>
                    Formulas are mostly written, not said, so the ones rebuilt
                    from speech are marked for you to check. Type $…$ in your
                    notes during class to write one yourself.
                  </Trans>
                </p>
              ) : null}
            </fieldset>
          )}

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
            <Button
              type="submit"
              disabled={start.isPending || !folderPath || !settings.learning}
            >
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
