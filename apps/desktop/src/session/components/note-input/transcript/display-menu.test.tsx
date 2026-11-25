import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChineseDisplayMenu } from "./display-menu";

import { parseChineseDisplay, useChineseDisplay } from "~/stt/pinyin";

const mocks = vi.hoisted(() => ({ translations: 0, isLesson: false }));

vi.mock("~/lesson/queries", () => ({
  useLessonSession: () => ({
    isLesson: mocks.isLesson,
    settings: null,
    folderPath: "",
  }),
  useLessonSheet: () => ({
    sheet: {
      translations: Array.from({ length: mocks.translations }, () => ({
        text: "你好",
        translation: "Hello",
      })),
    },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.translations = 0;
  mocks.isLesson = false;
  useChineseDisplay.getState().update({
    mode: "characters",
    toneColours: false,
    translation: false,
  });
  localStorage.clear();
});

describe("ChineseDisplayMenu", () => {
  it("offers the four ways to read Chinese and remembers the choice", () => {
    render(<ChineseDisplayMenu sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(
      screen.getAllByRole("radio").map((option) => option.textContent),
    ).toEqual(["Characters", "Pinyin above", "Word by word", "Pinyin only"]);
    expect(
      screen
        .getByRole("radio", { name: "Characters" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
    fireEvent.click(screen.getByRole("switch", { name: "Tone colours" }));

    expect(
      screen
        .getByRole("radio", { name: "Word by word" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      parseChineseDisplay(localStorage.getItem("mirna:transcript-pinyin")),
    ).toEqual({ mode: "word-by-word", toneColours: true, translation: false });
  });

  it("only offers translations when the lesson sheet has them", () => {
    const view = render(<ChineseDisplayMenu sessionId="session-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));

    expect(
      (screen.getByRole("switch", { name: "Translation" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    mocks.translations = 1;
    view.rerender(<ChineseDisplayMenu sessionId="session-1" />);
    const translation = screen.getByRole("switch", { name: "Translation" });
    fireEvent.click(translation);

    expect((translation as HTMLButtonElement).disabled).toBe(false);
    expect(useChineseDisplay.getState().translation).toBe(true);
  });

  it("shows a lesson with pinyin above in tone colours until a pick is made", () => {
    useChineseDisplay.setState({ chosen: false });
    mocks.isLesson = true;
    render(<ChineseDisplayMenu sessionId="session-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));

    expect(
      screen
        .getByRole("radio", { name: "Pinyin above" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("list", { name: "Tone colours" })).toBeTruthy();

    // Changing the mode keeps the lesson's tone colours.
    fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
    expect(
      parseChineseDisplay(localStorage.getItem("mirna:transcript-pinyin")),
    ).toEqual({ mode: "word-by-word", toneColours: true, translation: false });
  });
});
