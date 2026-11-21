import { describe, expect, it } from "vitest";

import { changelogUrl } from "./source";

describe("changelog sources", () => {
  it("never points at a remote changelog", () => {
    for (const version of ["1.4.24", "1.4.24-nightly.123", "../../main", ""]) {
      expect(changelogUrl(version)).toBeNull();
    }
  });
});
