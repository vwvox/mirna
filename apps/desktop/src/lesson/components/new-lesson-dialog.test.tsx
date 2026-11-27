import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markSessionAsLesson: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
  createSession: vi.fn(async () => "new-session"),
  requestLessonSheet: vi.fn(async () => {}),
  openSessionAndListen: vi.fn(),
  openCurrent: vi.fn(),
  createNamedFolder: vi.fn(async () => {}),
  lastLessons: [{ id: "old", folder_path: "Mandarin" }] as Array<{
    id: string;
    folder_path: string;
  }>,
  folders: ["Mandarin", "Statistics"],
  lastSettings: { learning: "zh", explainIn: "en" } as Record<
    string,
    unknown
  > | null,
}));

vi.mock("@anlg/plugin-detect", () => ({
  commands: {
    listMicUsingApplications: async () => ({
      status: "ok",
      data: [{ id: "com.google.Chrome", name: "Google Chrome" }],
    }),
  },
}));
vi.mock("../queries", () => ({
  loadCourseLessons: async () => [{ id: "a" }, { id: "b" }],
  loadCourseSettings: async () => mocks.lastSettings,
  loadLessonSession: async (id: string) => ({
    isLesson: id === "old",
    settings: id === "old" ? mocks.lastSettings : null,
    folderPath: "",
  }),
  markSessionAsLesson: mocks.markSessionAsLesson,
}));
vi.mock("./transcription-line", () => ({ TranscriptionLine: () => null }));
vi.mock("../auto", () => ({ requestLessonSheet: mocks.requestLessonSheet }));
vi.mock("~/ai/hooks", () => ({ useLanguageModel: () => "model" }));
vi.mock("~/db", () => ({
  liveQueryClient: {
    execute: async () => mocks.lastLessons,
  },
}));
vi.mock("~/session/folder-catalog", () => ({
  createNamedFolder: mocks.createNamedFolder,
}));
vi.mock("~/session/queries", () => ({
  createSession: mocks.createSession,
  updateSession: mocks.updateSession,
  useFolderPaths: () => mocks.folders,
}));
vi.mock("~/shared/useNewNote", () => ({
  openSessionAndListen: mocks.openSessionAndListen,
}));
vi.mock("~/store/zustand/tabs", () => ({
  useTabs: { getState: () => ({ openCurrent: mocks.openCurrent }) },
}));

import {
  NewLessonDialogHost,
  openMakeLessonDialog,
  openNewLessonDialog,
} from "./new-lesson-dialog";

import { useChineseDisplay } from "~/stt/pinyin";

function renderHost() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NewLessonDialogHost />
    </QueryClientProvider>,
  );
}

describe("new lesson dialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.lastLessons = [{ id: "old", folder_path: "Mandarin" }];
    mocks.folders = ["Mandarin", "Statistics"];
    mocks.lastSettings = { learning: "zh", explainIn: "en" };
  });

  it("asks for a course name and a language when there are no courses yet", async () => {
    mocks.lastLessons = [];
    mocks.folders = [];
    mocks.lastSettings = null;
    renderHost();
    act(() => openMakeLessonDialog("old-note", ""));
    const name = await screen.findByPlaceholderText("Mandarin with my teacher");
    const submit = screen.getByRole("button", {
      name: "Write the study sheet",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(name, { target: { value: "Chinese" } });
    const learning = screen.getByLabelText("I'm learning") as HTMLSelectElement;
    // No language is assumed for a first lesson.
    expect(learning.value).toBe("");
    expect(submit.disabled).toBe(true);
    fireEvent.change(learning, { target: { value: "zh" } });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.createNamedFolder).toHaveBeenCalledWith("Chinese"),
    );
    expect(mocks.updateSession).toHaveBeenCalledWith("old-note", {
      folder_id: "Chinese",
    });
  });

  it("starts a numbered lesson in the last course and starts recording", async () => {
    renderHost();
    act(() => openNewLessonDialog());
    await waitFor(() =>
      expect(screen.getByDisplayValue("Lesson 3")).toBeTruthy(),
    );
    expect(await screen.findByText(/comes through Google Chrome/)).toBeTruthy();
    const showAs = screen.getByLabelText(
      "Show Chinese as",
    ) as HTMLSelectElement;
    expect(showAs.value).toBe("pinyin-above");
    fireEvent.change(showAs, { target: { value: "word-by-word" } });

    fireEvent.click(screen.getByRole("button", { name: "Start lesson" }));
    await waitFor(() =>
      expect(mocks.openSessionAndListen).toHaveBeenCalledWith("new-session"),
    );
    expect(mocks.createSession).toHaveBeenCalledWith("Lesson 3", undefined, {
      folder_id: "Mandarin",
    });
    expect(mocks.markSessionAsLesson).toHaveBeenCalledWith("new-session", {
      learning: "zh",
      explainIn: "en",
    });
    expect(useChineseDisplay.getState()).toMatchObject({
      mode: "word-by-word",
      toneColours: true,
      chosen: true,
    });
  });

  it("makes an existing recording a lesson and writes its sheet", async () => {
    renderHost();
    act(() => openMakeLessonDialog("old-note", ""));
    const submit = await screen.findByRole("button", {
      name: "Write the study sheet",
    });
    await waitFor(() =>
      expect((submit as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.requestLessonSheet).toHaveBeenCalledWith(
        "old-note",
        "model",
        { force: true },
      ),
    );
    expect(mocks.updateSession).toHaveBeenCalledWith("old-note", {
      folder_id: "Mandarin",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.openCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "old-note",
        state: expect.objectContaining({ view: { type: "lesson" } }),
      }),
    );
  });

  it("starts a topic lesson with its subject, class language and the sections left out", async () => {
    renderHost();
    act(() => openNewLessonDialog());
    await waitFor(() =>
      expect(screen.getByDisplayValue("Lesson 3")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Topic/ }));
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Contract law" },
    });
    fireEvent.change(screen.getByLabelText("Class is in"), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByLabelText(/Main ideas/));
    expect(screen.queryByLabelText("Show Chinese as")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start lesson" }));
    await waitFor(() =>
      expect(mocks.markSessionAsLesson).toHaveBeenCalledWith("new-session", {
        learning: "en",
        explainIn: "en",
        subject: "topic",
        subjectName: "Contract law",
        leaveOut: ["ideas"],
      }),
    );
  });

  it("suggests a course name that fits the kind of class", async () => {
    mocks.lastLessons = [];
    mocks.folders = [];
    mocks.lastSettings = null;
    renderHost();
    act(() => openMakeLessonDialog("old-note", ""));
    await screen.findByPlaceholderText("Mandarin with my teacher");
    fireEvent.click(screen.getByRole("radio", { name: /Topic/ }));
    expect(screen.getByPlaceholderText("Law evening class")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Maths/ }));
    expect(screen.getByPlaceholderText("Statistics 101")).toBeTruthy();
  });
});
