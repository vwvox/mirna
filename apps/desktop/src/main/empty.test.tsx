import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => "macos"),
  lastNote: null as { id: string; title: string | null } | null,
  transcriptionLocal: true,
  openCurrent: vi.fn(),
}));

vi.mock("~/db", () => ({
  useLiveQuery: () => ({ data: mocks.lastNote }),
}));

vi.mock("~/shared/processing-location", () => ({
  useProcessingLocation: () => ({
    transcription: { label: "Whisper", local: mocks.transcriptionLocal },
    notes: { label: "Qwen 3.5", local: true },
    allLocal: mocks.transcriptionLocal,
  }),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: mocks.platform,
}));

vi.mock("~/shared/main", () => ({
  StandardContentWrapper: ({
    children,
    floatingButton,
  }: {
    children: React.ReactNode;
    floatingButton?: React.ReactNode;
  }) => (
    <div>
      {children}
      {floatingButton}
    </div>
  ),
}));

vi.mock("~/shared/useNewNote", () => ({
  useNewNote: () => vi.fn(),
  useNewNoteAndListen: () => vi.fn(),
}));

vi.mock("~/contexts/shell", () => ({
  useShell: () => ({
    chat: {
      mode: "FloatingClosed",
      sendEvent: vi.fn(),
    },
  }),
}));

vi.mock("~/store/zustand/tabs", () => ({
  useTabs: (selector: (state: { openCurrent: () => void }) => unknown) =>
    selector({
      openCurrent: mocks.openCurrent,
    }),
}));

import { greetingFor, TabContentEmpty } from "./empty";

describe("TabContentEmpty", () => {
  afterEach(() => {
    cleanup();
    mocks.platform.mockReturnValue("macos");
    mocks.lastNote = null;
    mocks.transcriptionLocal = true;
    mocks.openCurrent.mockClear();
  });

  it("shows the two starting points, the last note and the ask bar", () => {
    mocks.lastNote = { id: "session-9", title: "Dublin Audio Test" };
    renderHome();

    expect(
      screen.getByRole("button", { name: /Start recording/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Write a note/ })).toBeTruthy();
    expect(screen.getByText(/Audio stays on this Mac/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dublin Audio Test/ }));
    expect(mocks.openCurrent).toHaveBeenCalledWith({
      type: "sessions",
      id: "session-9",
    });
    expect(
      screen.getByRole("button", { name: "Ask Mirna anything" }),
    ).toBeTruthy();
  });

  it("does not promise local audio when transcription runs in the cloud", () => {
    mocks.transcriptionLocal = false;
    mocks.lastNote = null;
    renderHome();

    expect(screen.queryByText(/Audio stays on this Mac/)).toBeNull();
    expect(screen.queryByText("Last note")).toBeNull();
  });

  it("greets by time of day", () => {
    expect(greetingFor(8)).toBe("morning");
    expect(greetingFor(14)).toBe("afternoon");
    expect(greetingFor(21)).toBe("evening");
    expect(greetingFor(2)).toBe("evening");
  });
});

function renderHome() {
  render(
    <TabContentEmpty
      tab={{
        active: true,
        pinned: false,
        slotId: "slot-home",
        type: "empty",
      }}
    />,
  );
}
