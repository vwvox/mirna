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
  settings: { learning: "zh", explainIn: "en" } as Record<string, unknown>,
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
    settings: mocks.settings,
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
  kind: "language",
  keyTerms: [],
  ideas: [],
  sources: [],
  methods: [],
  checkYourself: [],
  formulas: [],
  workedExamples: [],
  problems: [],
  topic: "",
  summary: "You practised 都.",
  chapters: [],
  vocabulary: [
    {
      term: "饺子",
      reading: "jiǎozi",
      meaning: "dumplings",
      note: "",
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
    mocks.settings = { learning: "zh", explainIn: "en" };
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

  it("shows a topic sheet's own sections and hides the empty ones", () => {
    mocks.settings = {
      learning: "en",
      explainIn: "en",
      subject: "topic",
      subjectName: "Contract law",
    };
    mocks.sheet = {
      ...SHEET,
      kind: "subject",
      summary: "Offer and acceptance.",
      vocabulary: [],
      patterns: [],
      keyTerms: [
        {
          term: "Offer",
          definition: "A clear promise to be bound",
          heardAtMs: 290_000,
          isNew: true,
        },
      ],
      sources: [
        {
          name: "Hyde v Wrench",
          kind: "case",
          year: "1840",
          note: "A counter-offer kills the offer.",
          atMs: null,
        },
      ],
      methods: [
        {
          title: "Is there a contract?",
          atMs: 2_290_000,
          steps: [{ text: "An offer, or an invitation to treat?", atMs: null }],
        },
      ],
      formulas: [
        {
          name: "Damages",
          latex: "D = L - M",
          symbols: [],
          whenToUse: "",
          atMs: null,
          from: "speech",
        },
      ],
      corrections: [
        { said: "an advert", corrected: "an invitation", why: "", atMs: null },
      ],
    };
    render(wrap(<LessonStudySheet sessionId="s1" />));
    expect(screen.getByText("Topic lesson · Contract law")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Key terms/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Cases and laws/ })).toBeTruthy();
    expect(screen.getByText("Is there a contract?")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Common slips/ })).toBeTruthy();
    expect(
      screen.getByText("Rebuilt from what was said · check it"),
    ).toBeTruthy();
    expect(screen.getByText("Check 1 formula")).toBeTruthy();
    expect(screen.getByLabelText("Make a card for Offer")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Main ideas/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Words/ })).toBeNull();
    expect(screen.queryByText("Pleco flashcards")).toBeNull();
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
