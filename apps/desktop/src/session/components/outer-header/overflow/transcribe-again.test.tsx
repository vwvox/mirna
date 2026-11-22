import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscribeAgain } from "./transcribe-again";

const { isModelDownloaded } = vi.hoisted(() => ({
  isModelDownloaded: vi.fn(),
}));

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: { isModelDownloaded },
}));

vi.mock("~/shared/processing-location", () => ({
  useProcessingLocation: () => ({
    transcription: { label: "Parakeet", local: true },
    notes: null,
    allLocal: false,
  }),
}));

vi.mock("@anlg/ui/components/ui/dropdown-menu", () => ({
  AppFloatingPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
  appFloatingMenuPanelClassName: "",
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function renderMenu(onTranscribe = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TranscribeAgain onTranscribe={onTranscribe} />
    </QueryClientProvider>,
  );
  return onTranscribe;
}

describe("TranscribeAgain", () => {
  beforeEach(() => {
    isModelDownloaded.mockReset();
  });
  afterEach(cleanup);

  it("offers each downloaded on-device engine for this recording", async () => {
    isModelDownloaded.mockImplementation(async (model: string) => ({
      status: "ok",
      data: model !== "soniqo-qwen3-large",
    }));
    const onTranscribe = renderMenu();

    fireEvent.click(await screen.findByRole("button", { name: /Qwen3-ASR/ }));
    expect(onTranscribe).toHaveBeenLastCalledWith({
      provider: "soniqo",
      model: "soniqo-qwen3-small",
    });
    expect(screen.queryByText("Qwen3-ASR Large")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /With your settings/ }));
    expect(onTranscribe).toHaveBeenLastCalledWith();
    expect(screen.getByText("Parakeet", { selector: ".text-xs" })).toBeTruthy();
  });

  it("is a plain item when no on-device engine is downloaded", async () => {
    isModelDownloaded.mockResolvedValue({ status: "ok", data: false });
    const onTranscribe = renderMenu();

    fireEvent.click(
      await screen.findByRole("button", { name: "Transcribe again" }),
    );
    expect(onTranscribe).toHaveBeenCalledWith();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
