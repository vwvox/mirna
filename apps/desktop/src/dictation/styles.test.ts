import { describe, expect, it } from "vitest";

import { appCategory, parseWritingStyle } from "./styles";

describe("dictation writing styles", () => {
  it("groups known apps by bundle id and treats the rest as other", () => {
    const app = (bundleId: string | null) => ({ bundleId, appName: null });
    expect(appCategory(app("com.apple.MobileSMS"))).toBe("personal");
    expect(appCategory(app("com.tinyspeck.slackmacgap"))).toBe("work");
    expect(appCategory(app("com.apple.mail"))).toBe("email");
    expect(appCategory(app("com.google.Chrome"))).toBe("other");
    expect(appCategory(app(null))).toBe("other");
    expect(appCategory(null)).toBe("other");
  });

  it("reads an unknown or missing stored style as formal", () => {
    expect(parseWritingStyle("veryCasual")).toBe("veryCasual");
    expect(parseWritingStyle("shouty")).toBe("formal");
    expect(parseWritingStyle(undefined)).toBe("formal");
  });
});
