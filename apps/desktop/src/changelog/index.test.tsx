import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", async () => {
  const actual = await vi.importActual<object>("@lingui/react/macro");
  return {
    ...actual,
    useLingui: () => ({
      t: (s: TemplateStringsArray) => s.join(""),
      i18n: { locale: "en-GB" },
    }),
  };
});
vi.mock("@anlg/plugin-opener2", () => ({ commands: { openUrl: vi.fn() } }));
vi.mock("~/contexts/shell", () => ({ useShell: vi.fn() }));
vi.mock("~/shared/main", () => ({ StandardContentWrapper: () => null }));
vi.mock("~/store/zustand/tabs", () => ({ useTabs: vi.fn() }));

import { formatReleaseDate, ReleaseList } from "./index";
import type { Release } from "./releases";

const releases: Release[] = [
  {
    version: "0.1.0-beta.4",
    date: "2026-11-25",
    summary: "Mixed languages.",
    content: "- Qwen3-ASR for lessons.",
  },
  {
    version: "0.1.0-beta.3",
    date: "2026-11-23",
    summary: "Voices.",
    content: "- Shared mics.",
  },
  {
    version: "0.1.0-beta.2",
    date: "2026-11-23",
    summary: "Android.",
    content: "- Pair a phone.",
  },
];

describe("What's new", () => {
  afterEach(cleanup);

  it("lists every release newest first, marking what this update brought", () => {
    render(
      <ReleaseList
        releases={releases}
        current="0.1.0-beta.4"
        previous="0.1.0-beta.2"
      />,
    );
    const sections = screen.getAllByRole("region");
    expect(
      sections.map((section) => section.getAttribute("aria-label")),
    ).toEqual(["0.1.0-beta.4", "0.1.0-beta.3", "0.1.0-beta.2"]);
    expect(within(sections[0]!).getByText("New")).toBeTruthy();
    expect(within(sections[1]!).getByText("New")).toBeTruthy();
    expect(within(sections[2]!).queryByText("New")).toBeNull();
    expect(within(sections[0]!).getByText("Mixed languages.")).toBeTruthy();
    expect(within(sections[0]!).getByText(/25.+2026/)).toBeTruthy();
  });

  it("calls the running version out when opened from Settings", () => {
    render(
      <ReleaseList
        releases={releases}
        current="0.1.0-beta.4"
        previous="0.1.0-beta.4"
      />,
    );
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.getByText("This version")).toBeTruthy();
  });

  it("formats dates in the app's language and ignores bad ones", () => {
    expect(formatReleaseDate("2026-11-25", "en-US")).toBe("Nov 25, 2026");
    expect(formatReleaseDate("soon", "en-GB")).toBeNull();
    expect(formatReleaseDate(null, "en-GB")).toBeNull();
  });
});
