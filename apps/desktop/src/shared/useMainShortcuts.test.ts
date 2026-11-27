import { afterEach, describe, expect, it } from "vitest";

import {
  getEscapeShortcutContext,
  shouldSkipEscapeShortcut,
} from "./useMainShortcuts";

function handledEscape() {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  event.preventDefault();
  return event;
}

describe("the Escape shortcut", () => {
  afterEach(() => document.body.replaceChildren());

  it("leaves an open review to close itself, even with focus on the page", () => {
    const review = document.createElement("div");
    review.setAttribute("data-escape-consumer", "");
    document.body.append(review);

    expect(
      shouldSkipEscapeShortcut(
        handledEscape(),
        getEscapeShortcutContext(document.body),
      ),
    ).toBe(true);
  });

  it("still leaves the tab when nothing open takes Escape", () => {
    expect(
      shouldSkipEscapeShortcut(
        handledEscape(),
        getEscapeShortcutContext(document.body),
      ),
    ).toBe(false);
  });
});
