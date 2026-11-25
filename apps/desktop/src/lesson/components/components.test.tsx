import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LessonSheet } from "../types";

const mocks = vi.hoisted(() => ({
  sheet: null as LessonSheet | null,
  addLessonMark: vi.fn(async () => null),
  addLessonQuestion: vi.fn(async () => null),
  addHomeworkTodo: vi.fn(async () => {}),
  setHomeworkDone: vi.fn(async () => {}),
  requestLessonSheet: vi.fn(async () => {}),
  playRange: vi.fn(),
}));

vi.mock("../practice-data", () => ({
  usePracticeDue: () => ({ cards: 3, due: 3, fromOtherLessons: 2 }),
}));
vi.mock("../documents", () => ({
  useLessonDocument: () => null,
  updateLessonDocument: vi.fn(),
}));
vi.mock("../queries", () => ({
  useCourseLessons: () => [],
  useCourseSheets: () => new Map(),
  useLessonSession: () => ({
    isLesson: true,
    settings: { learning: "zh", explainIn: "en" },
    folderPath: "Mandarin",
  }),
  useLessonSheet: () =>
    mocks.sheet
      ? {
          sheet: mocks.sheet,
          generatedAt: "",
          model: "deepseek-flash",
          sourceHash: "",
        }
      : null,
}));
vi.mock("../marks", () => ({
  useLessonMarks: () => ({
    version: 1,
    marks: [
      {
        id: "m1",
        kind: "confused",
        atMs: 61_000,
        note: "不都?",
        createdAt: "",
      },
    ],
    questions: [],
  }),
  addLessonMark: mocks.addLessonMark,
  addLessonQuestion: mocks.addLessonQuestion,
  removeLessonMark: vi.fn(),
  updateLessonMarkNote: vi.fn(),
  setLessonQuestionAsked: vi.fn(),
  useCourseMarks: () => new Map(),
}));
vi.mock("../auto", () => ({
  requestLessonSheet: mocks.requestLessonSheet,
  useLessonSheetStatus: (select: (state: { bySession: object }) => unknown) =>
    select({ bySession: {} }),
}));
vi.mock("../homework", () => ({
  addHomeworkTodo: mocks.addHomeworkTodo,
  setHomeworkDone: mocks.setHomeworkDone,
  useHomeworkStatuses: () => new Map(),
  courseHomework: () => [],
  homeworkTodoId: (sessionId: string, text: string) => `${sessionId}:${text}`,
  useHomeworkTodoIds: () => new Set<string>(),
}));
vi.mock("../use-lesson-segments", () => ({
  useLessonTranscript: () => ({
    segments: [],
    roleOf: () => null,
    ready: false,
  }),
}));
vi.mock("../use-previous-lesson", () => ({ usePreviousLesson: () => null }));
vi.mock("./practice-dialog", () => ({ LessonPracticeDialog: () => null }));
vi.mock("./talk-strip", () => ({ TalkStrip: () => null }));
vi.mock("~/ai/hooks", () => ({ useLanguageModel: () => "model" }));
vi.mock("~/audio-player/provider", () => ({
  useAudioPlayer: () => ({ audioExists: true, playRange: mocks.playRange }),
}));
vi.mock("~/session/queries", () => ({
  useSession: () => ({ title: "Lesson 14" }),
}));
vi.mock("~/session/components/note-input/transcript/display-menu", () => ({
  ChineseDisplayMenu: () => null,
}));
vi.mock("~/stt/pinyin", () => ({
  useEffectiveChineseDisplay: () => ({
    mode: "characters",
    toneColours: true,
    translation: false,
  }),
  CJK_FONT_STACK: "sans-serif",
  hasHan: (text: string) => /\p{Script=Han}/u.test(text),
  toneClass: () => "",
  usePinyinModule: () => null,
}));

import { LessonBoard } from "./lesson-board";
import { LessonStudySheet } from "./study-sheet";

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

const SHEET: LessonSheet = {
  version: 1,
  topic: "",
  summary: "You practised 都.",
  chapters: [],
  vocabulary: [
    {
      term: "饺子",
      reading: "jiǎozi",
      meaning: "dumplings",
      heardAtMs: 769_000,
      isNew: true,
    },
  ],
  patterns: [
    {
      pattern: "Subject + 都 + verb",
      explanation: "都 goes before the verb.",
      examples: [
        {
          text: "我们都喝茶。",
          translation: "We all drink tea.",
          atMs: 1_275_000,
        },
      ],
    },
  ],
  corrections: [
    { said: "jiāozi", corrected: "jiǎozi", why: "Third tone.", atMs: 778_000 },
  ],
  homework: [
    { text: "Write five sentences with 都", due: "Thursday", atMs: 1_247_000 },
  ],
  markAnswers: [{ markId: "m1", answer: "Explained at 18:40." }],
  openQuestions: [],
  translations: [],
  talk: { studentMs: 1_000, teacherMs: 3_000 },
};

describe("lesson screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sheet = SHEET;
  });
  afterEach(cleanup);

  it("shows every part of the study sheet and acts on it", async () => {
    render(wrap(<LessonStudySheet sessionId="s1" />));
    expect(screen.getByText("You practised 都.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Practise 3 cards" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/2 more are due from earlier lessons/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Make a card for 饺子") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByText("dumplings")).toBeTruthy();
    expect(screen.getByText("Subject + 都 + verb")).toBeTruthy();
    expect(screen.getByText("jiāozi")).toBeTruthy();
    expect(screen.getByText("Explained at 18:40.")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Done: Write five sentences with 都",
      }),
    );
    await waitFor(() =>
      expect(mocks.setHomeworkDone).toHaveBeenCalledWith(
        "s1",
        SHEET.homework[0],
        true,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Add to to-dos/ }));
    await waitFor(() =>
      expect(mocks.addHomeworkTodo).toHaveBeenCalledWith(
        "s1",
        SHEET.homework[0],
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Play the teacher saying 饺子" }),
    );
    expect(mocks.playRange).toHaveBeenCalledWith(769, 773);

    fireEvent.click(screen.getByRole("button", { name: /Write again/ }));
    expect(mocks.requestLessonSheet).toHaveBeenCalledWith("s1", "model", {
      force: true,
    });
  });

  it("offers to write the sheet when there is none yet", () => {
    mocks.sheet = null;
    render(wrap(<LessonStudySheet sessionId="s1" />));
    fireEvent.click(screen.getByRole("button", { name: "Write it now" }));
    expect(mocks.requestLessonSheet).toHaveBeenCalled();
  });

  it("marks moments and saves questions from the board", () => {
    render(wrap(<LessonBoard sessionId="s1" />));
    fireEvent.click(screen.getByRole("button", { name: /I didn't get this/ }));
    expect(mocks.addLessonMark).toHaveBeenCalledWith("s1", "confused");
    expect(screen.getByDisplayValue("不都?")).toBeTruthy();

    const input = screen.getByLabelText("Question for after class");
    fireEvent.change(input, { target: { value: "Can 都 go with 每?" } });
    fireEvent.submit(input.closest("form")!);
    expect(mocks.addLessonQuestion).toHaveBeenCalledWith(
      "s1",
      "Can 都 go with 每?",
    );
  });
});
