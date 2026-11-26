import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openCurrent: vi.fn(),
  rows: [] as Array<{ folder_path: string; lessons: number }>,
  lessonIds: [] as string[],
  documents: [] as Array<Record<string, string>>,
}));

vi.mock("~/db", () => ({
  useLiveQuery: ({
    sql,
    mapRows,
  }: {
    sql: string;
    mapRows: (rows: unknown[]) => unknown;
  }) => {
    if (sql.includes("GROUP BY folder_path")) {
      return { data: mapRows(mocks.rows) };
    }
    if (sql.includes("SELECT id FROM sessions")) {
      return { data: mapRows(mocks.lessonIds.map((id) => ({ id }))) };
    }
    return { data: mapRows(mocks.documents) };
  },
}));
vi.mock("./practice-dialog", () => ({
  LessonPracticeDialog: ({ title }: { title: string }) => (
    <div role="dialog">{title}</div>
  ),
}));
vi.mock("~/store/zustand/tabs", () => {
  const state = { currentTab: null, openCurrent: mocks.openCurrent };
  const useTabs = (select: (value: typeof state) => unknown) => select(state);
  useTabs.getState = () => state;
  return { useTabs };
});

import { SidebarCourses } from "./sidebar-courses";

import { useFolderSelection } from "~/folders/selection";

describe("courses in the sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.lessonIds = [];
    mocks.documents = [];
  });

  it("lists courses with lessons and opens a course's page", () => {
    mocks.rows = [{ folder_path: "Mandarin", lessons: 4 }];
    render(<SidebarCourses />);

    fireEvent.click(screen.getByRole("button", { name: /Mandarin/ }));

    expect(useFolderSelection.getState().selectedPath).toBe("Mandarin");
    expect(mocks.openCurrent).toHaveBeenCalledWith({ type: "folders" });
  });

  it("offers practice across every lesson, with how many words are due", () => {
    mocks.rows = [{ folder_path: "Mandarin", lessons: 1 }];
    mocks.lessonIds = ["lesson-1"];
    mocks.documents = [
      {
        session_id: "lesson-1",
        kind: "lesson_sheet",
        title: "Lesson 1",
        started: "2026-11-25",
        body: JSON.stringify({
          sheet: { vocabulary: [{ term: "都" }, { term: "也" }] },
        }),
      },
    ];
    render(<SidebarCourses />);

    expect(screen.getByLabelText("2 words due").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: /Practise/ }));
    expect(screen.getByRole("dialog").textContent).toBe("All your lessons");
  });

  it("stays out of the way until there is a course", () => {
    const { container } = render(<SidebarCourses />);
    expect(container.textContent).toBe("");
  });
});
