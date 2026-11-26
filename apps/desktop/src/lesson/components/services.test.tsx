import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(async () => ({ status: "ok", data: null })),
  listen: vi.fn(),
  addLessonMark: vi.fn(async () => ({ atMs: 61_000 })),
  handler: null as null | ((event: { payload: { index: number } }) => void),
}));

vi.mock("@anlg/plugin-shortcut", () => ({
  commands: {
    registerMarkShortcuts: mocks.register,
    unregisterMarkShortcuts: mocks.unregister,
  },
  events: {
    markShortcut: {
      listen: async (
        handler: (event: { payload: { index: number } }) => void,
      ) => {
        mocks.handler = handler;
        return mocks.listen;
      },
    },
  },
}));
vi.mock("~/stt/contexts", () => ({
  useListener: (select: (state: unknown) => unknown) =>
    select({ live: { status: "active", sessionId: "lesson-1" } }),
}));
vi.mock("../queries", () => ({
  useLessonSession: () => ({ isLesson: true, settings: null, folderPath: "" }),
}));
vi.mock("../marks", () => ({ addLessonMark: mocks.addLessonMark }));
vi.mock("./new-lesson-dialog", () => ({ NewLessonDialogHost: () => null }));
vi.mock("./study-sheet", () => ({
  useMarkLabels: () => ({
    important: "Important",
    confused: "Didn't get it",
    homework: "Homework",
  }),
}));

import { useMarkShortcutLabels } from "../shortcut-labels";
import { LessonServices } from "./services";

describe("lesson mark shortcuts", () => {
  afterEach(cleanup);

  it("falls back to Control+Option when Option-only keys are refused, and marks on press", async () => {
    mocks.register
      .mockResolvedValueOnce({ status: "error", error: "refused" })
      .mockResolvedValueOnce({ status: "ok", data: null });
    const { unmount } = render(<LessonServices />);

    await waitFor(() =>
      expect(mocks.register).toHaveBeenLastCalledWith([
        "Control+Alt+1",
        "Control+Alt+2",
        "Control+Alt+3",
      ]),
    );
    await waitFor(() => expect(mocks.handler).not.toBeNull());
    expect(useMarkShortcutLabels.getState().labels).toEqual([
      "⌃⌥1",
      "⌃⌥2",
      "⌃⌥3",
    ]);

    mocks.handler!({ payload: { index: 1 } });
    expect(mocks.addLessonMark).toHaveBeenCalledWith("lesson-1", "confused");

    unmount();
    await waitFor(() => expect(mocks.unregister).toHaveBeenCalled());
    expect(mocks.listen).toHaveBeenCalled();
  });
});
