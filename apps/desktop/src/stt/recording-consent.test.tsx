import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { acknowledged, setSettingValueMock, windowShowMock } = vi.hoisted(
  () => ({
    acknowledged: { value: false },
    setSettingValueMock: vi.fn(),
    windowShowMock: vi.fn(),
  }),
);

vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: async () => ({}),
  setSettingValue: setSettingValueMock,
}));

vi.mock("~/shared/config", () => ({
  resolveConfigValue: (key: string) =>
    key === "recording_consent_acknowledged" ? acknowledged.value : undefined,
}));

vi.mock("@anlg/plugin-windows", () => ({
  commands: { windowShow: windowShowMock },
}));

import {
  confirmRecordingConsent,
  RecordingConsentDialog,
  reviewRecordingConsent,
} from "./recording-consent";

beforeEach(() => {
  acknowledged.value = false;
  setSettingValueMock.mockReset().mockImplementation(async () => {
    acknowledged.value = true;
  });
  windowShowMock.mockReset().mockResolvedValue({ status: "ok" });
  render(createElement(RecordingConsentDialog));
});

afterEach(async () => {
  const [close] = screen.queryAllByRole("button", {
    name: /^(Cancel|Close)$/,
  });
  if (close) {
    await act(async () => {
      fireEvent.click(close);
    });
  }
  cleanup();
});

// Returns the answer wrapped, so awaiting the helper waits for the screen to
// open rather than for the user's answer.
async function askForConsent() {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = confirmRecordingConsent();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { answer };
}

describe("recording consent", () => {
  it("starts straight away once the user has read the screen before", async () => {
    acknowledged.value = true;

    await expect(confirmRecordingConsent()).resolves.toBe(true);
    expect(screen.queryByText("Before you record")).toBeNull();
    expect(windowShowMock).not.toHaveBeenCalled();
  });

  it("asks before the first recording and remembers the answer", async () => {
    const { answer } = await askForConsent();

    expect(screen.getByText("Before you record")).toBeTruthy();
    expect(screen.getByText(/This isn't legal advice/)).toBeTruthy();
    expect(windowShowMock).toHaveBeenCalledWith({ type: "main" });
    expect(setSettingValueMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "I understand, start recording" }),
      );
    });

    await expect(answer).resolves.toBe(true);
    expect(setSettingValueMock).toHaveBeenCalledWith(
      "recording_consent_acknowledged",
      true,
    );
    expect(screen.queryByText("Before you record")).toBeNull();
  });

  it("does not record or remember anything when the user cancels", async () => {
    const { answer } = await askForConsent();
    expect(screen.getByText("Before you record")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await expect(answer).resolves.toBe(false);
    expect(setSettingValueMock).not.toHaveBeenCalled();
  });

  it("shows one screen when several starts arrive together", async () => {
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = confirmRecordingConsent();
      second = confirmRecordingConsent();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getAllByText("Before you record")).toHaveLength(1);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "I understand, start recording" }),
      );
    });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("lets a start that arrives while the answer is being saved share it", async () => {
    let finishSaving!: () => void;
    setSettingValueMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = () => {
            acknowledged.value = true;
            resolve();
          };
        }),
    );
    const { answer: first } = await askForConsent();
    expect(screen.getByText("Before you record")).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "I understand, start recording" }),
      );
    });
    const { answer: late } = await askForConsent();
    await act(async () => {
      finishSaving();
    });

    await expect(Promise.all([first, late])).resolves.toEqual([true, true]);
    expect(screen.queryByText("Before you record")).toBeNull();
  });

  it("can be read again from Settings without offering to record", async () => {
    await act(async () => {
      reviewRecordingConsent();
    });

    expect(screen.getByText("Before you record")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "I understand, start recording" }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    });

    expect(screen.queryByText("Before you record")).toBeNull();
    expect(setSettingValueMock).not.toHaveBeenCalled();
  });
});
