import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inactive: true,
  disabled: false,
  show: vi.fn(),
}));

vi.mock("@anlg/plugin-notification", () => ({
  commands: { showNotification: (n: unknown) => mocks.show(n) },
}));
vi.mock("~/shared/window-activity", () => ({
  isAppWindowInactive: async () => mocks.inactive,
}));
vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: async () => ({ values: {} }),
}));
vi.mock("~/shared/config", () => ({
  resolveConfigValue: (key: string) =>
    key === "notification_disabled" ? mocks.disabled : undefined,
}));

import { showDictationErrorNotification } from "./error-notification";

describe("dictation error notification", () => {
  beforeEach(() => {
    mocks.inactive = true;
    mocks.disabled = false;
    mocks.show.mockReset();
    mocks.show.mockResolvedValue({ status: "ok", data: null });
  });

  it("tells the person about a failure while another app is in front", async () => {
    await showDictationErrorNotification("Couldn't insert the text.");
    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Dictation didn't finish",
        message: "Couldn't insert the text.",
      }),
    );
  });

  it("stays quiet when Mirna is in front or notifications are off", async () => {
    mocks.inactive = false;
    await showDictationErrorNotification("Recording failed.");
    mocks.inactive = true;
    mocks.disabled = true;
    await showDictationErrorNotification("Recording failed.");
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
