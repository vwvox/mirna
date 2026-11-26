import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LessonTerm } from "./term";

import { useChineseDisplay } from "~/stt/pinyin";

describe("a Chinese word in lesson views", () => {
  afterEach(() => {
    cleanup();
    useChineseDisplay.setState({
      mode: "characters",
      toneColours: false,
      translation: false,
      chosen: true,
    });
  });

  it("shows pinyin above each character by default", async () => {
    useChineseDisplay.setState({ chosen: false });
    const { container } = render(<LessonTerm term="你好" />);
    await waitFor(() =>
      expect(
        [...container.querySelectorAll("rt")].map((rt) => rt.textContent),
      ).toEqual(["nǐ", "hǎo"]),
    );
  });

  it("follows a pick of characters alone, and hides pinyin when asked", async () => {
    useChineseDisplay.setState({ mode: "characters", chosen: true });
    const plain = render(<LessonTerm term="你好" />);
    expect(plain.container.querySelector("rt")).toBeNull();
    cleanup();

    useChineseDisplay.setState({ mode: "pinyin-above", chosen: true });
    const hidden = render(<LessonTerm term="你好" pinyin={false} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hidden.container.querySelector("rt")).toBeNull();
  });
});
