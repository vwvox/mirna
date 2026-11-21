import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoredAiProvider: vi.fn(),
  getStoredSettingValues: vi.fn(),
  setSettingValues: vi.fn(async () => undefined),
}));

vi.mock("~/settings/providers", () => ({
  getStoredAiProvider: mocks.getStoredAiProvider,
}));

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: mocks.getStoredSettingValues,
  setSettingValues: mocks.setSettingValues,
}));

import { configurePaidSettings } from "./configure-paid-settings";

describe("configurePaidSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredSettingValues.mockResolvedValue({
      values: {},
      hasValues: new Set(),
    });
  });

  it("never switches the user onto vendor-hosted transcription or AI", async () => {
    await configurePaidSettings();

    expect(mocks.setSettingValues).not.toHaveBeenCalled();
  });
});
