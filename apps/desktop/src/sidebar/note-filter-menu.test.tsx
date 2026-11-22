import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce(
        (message, part, index) =>
          `${message}${part}${index < values.length ? String(values[index]) : ""}`,
        "",
      ),
  }),
}));

import { resetSidebarNotes, useSidebarNotes } from "./note-filter";
import { SidebarNoteFilterMenu } from "./note-filter-menu";

function openSortMenu() {
  const trigger = screen.getByRole("button", { name: "Group and sort" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

function openSubmenu(name: string) {
  const trigger = screen.getByRole("menuitem", { name });
  fireEvent.focus(trigger);
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
}

describe("SidebarNoteFilterMenu", () => {
  beforeEach(() => {
    resetSidebarNotes();
  });

  afterEach(() => {
    cleanup();
    resetSidebarNotes();
  });

  it("switches the timeline to a folder-grouped view", () => {
    render(<SidebarNoteFilterMenu />);

    openSortMenu();
    openSubmenu("Grouping, Date");
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder" }));

    expect(useSidebarNotes.getState().groupBy).toBe("folder");
  });

  it("orders notes from oldest to newest", () => {
    render(<SidebarNoteFilterMenu />);

    openSortMenu();
    openSubmenu("Ordering, Newest");
    fireEvent.click(screen.getByRole("menuitem", { name: "Oldest" }));

    expect(useSidebarNotes.getState().sortOrder).toBe("oldest");
  });
});

describe("folderLabel", () => {
  it("shows the last part of a nested folder path", async () => {
    const { folderLabel } = await import("./note-filter-menu");
    expect(folderLabel("Work/Clients/Acme")).toBe("Acme");
    expect(folderLabel("Personal")).toBe("Personal");
  });
});
