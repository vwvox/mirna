import { describe, expect, it } from "vitest";

import { FLOATING_BAR_COMPACT_ICON_SIZE, compactControlsWidth } from "./layout";

describe("compactControlsWidth", () => {
  it.each([true, false])(
    "widens by one icon for the pause button (expand %s)",
    (showsExpand) => {
      expect(compactControlsWidth(showsExpand, true)).toBe(
        compactControlsWidth(showsExpand, false) +
          FLOATING_BAR_COMPACT_ICON_SIZE,
      );
    },
  );

  it("matches the native panel widths", () => {
    expect(compactControlsWidth(true, false)).toBe(92);
    expect(compactControlsWidth(true, true)).toBe(122);
    expect(compactControlsWidth(false, true)).toBe(98);
  });
});
