import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FloatingBarState } from "@anlg/plugin-windows";

import { FloatingBarOverlay } from "./bar";

vi.mock("@anlg/ui/components/ui/dancing-sticks", () => ({
  DancingSticks: ({ amplitude }: { amplitude: number }) => (
    <span data-testid="waveform" data-amplitude={amplitude} />
  ),
}));

function state(overrides: Partial<FloatingBarState> = {}): FloatingBarState {
  return {
    dictation: null,
    amplitude: 0.4,
    title: "Weekly sync",
    status: "recording",
    colorScheme: "light",
    opacity: 0.78,
    liveCaptionOpacity: 0.3,
    liveCaptionWidth: 440,
    liveCaptionLineCount: 1,
    liveCaptionPosition: "topCenter",
    liveCaptionMinimized: true,
    liveCaptionToggleVisible: true,
    transcriptBubbles: [
      {
        id: "1",
        speakerLabel: "Ada",
        text: "Let's start.",
        isSelf: false,
        isFinal: true,
        startMs: 0,
        endMs: 1200,
        overlapsPrevious: false,
        overlapsNext: false,
      },
    ],
    ...overrides,
  };
}

describe("FloatingBarOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  it.each(["recording", "reconnecting", "error"] as const)(
    "stops listening while %s",
    (status) => {
      const onStop = vi.fn();

      render(
        <FloatingBarOverlay
          state={state({ status })}
          onStop={onStop}
          onSetPaused={vi.fn()}
          onToggleExpanded={vi.fn()}
          onMark={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /stop listening/i }));

      expect(onStop).toHaveBeenCalledOnce();
    },
  );

  it("expands to the live transcript and can collapse again", () => {
    const onToggleExpanded = vi.fn();

    const view = render(
      <FloatingBarOverlay
        state={state()}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onToggleExpanded={onToggleExpanded}
        onMark={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Expand live transcript",
    });
    fireEvent.click(toggle);
    expect(onToggleExpanded).toHaveBeenCalledWith(true);

    view.rerender(
      <FloatingBarOverlay
        state={state({ liveCaptionMinimized: false })}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onToggleExpanded={onToggleExpanded}
        onMark={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: "Collapse live transcript" });
    expect(screen.getByText("Let's start.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse live transcript" }),
    );
    expect(onToggleExpanded).toHaveBeenCalledWith(false);
  });

  it("shows lesson marks only for lesson recordings", () => {
    const view = render(
      <FloatingBarOverlay
        state={state()}
        onStop={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
        onSetPaused={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Mark as/ })).toBeNull();

    view.rerender(
      <FloatingBarOverlay
        state={state({
          marksEnabled: true,
          dictation: {
            sessionId: "dictation-1",
            phase: "recording",
            microphone: "Mic",
            text: "",
            partial: "",
            previewEnabled: true,
            previewUnavailable: false,
          },
        })}
        onStop={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
        onSetPaused={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Mark as/ })).toBeNull();
  });

  it("reports each lesson mark and confirms the press", () => {
    const onMark = vi.fn();
    render(
      <FloatingBarOverlay
        state={state({ marksEnabled: true })}
        onStop={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMark={onMark}
        onSetPaused={vi.fn()}
      />,
    );

    for (const [name, title, kind] of [
      ["Mark as important", "Important (Alt+1)", "important"],
      ["Mark as didn't get it", "I didn't get this (Alt+2)", "confused"],
      ["Mark as homework", "Homework (Alt+3)", "homework"],
    ] as const) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("title")).toBe(title);
      fireEvent.click(button);
      expect(onMark).toHaveBeenLastCalledWith(kind);
      expect(button.dataset.confirming).toBe("true");
    }
    expect(onMark).toHaveBeenCalledTimes(3);
    screen.getByRole("button", { name: /stop listening/i });
  });

  it("pauses a meeting recording and shows a still indicator until resumed", () => {
    const onSetPaused = vi.fn();
    const onStop = vi.fn();

    const view = render(
      <FloatingBarOverlay
        state={state()}
        onStop={onStop}
        onSetPaused={onSetPaused}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
      />,
    );

    expect(screen.getByTestId("waveform")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(onSetPaused).toHaveBeenCalledWith(true);

    view.rerender(
      <FloatingBarOverlay
        state={state({ paused: true, amplitude: 0 })}
        onStop={onStop}
        onSetPaused={onSetPaused}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("waveform")).toBeNull();
    expect(screen.getByTestId("paused-indicator")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    expect(onSetPaused).toHaveBeenLastCalledWith(false);

    const stop = screen.getByRole("button", {
      name: "Recording paused; stop listening",
    });
    fireEvent.mouseEnter(stop);
    expect(screen.getByText("Stop")).toBeTruthy();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps the error state visible while paused", () => {
    render(
      <FloatingBarOverlay
        state={state({ paused: true, status: "error" })}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("paused-indicator")).toBeNull();
    screen.getByRole("button", { name: /needs attention; stop listening/i });
  });

  it("does not offer pause during dictation", () => {
    render(
      <FloatingBarOverlay
        state={state({
          dictation: {
            sessionId: "dictation-1",
            phase: "recording",
            microphone: "Mic",
            text: "",
            partial: "",
            previewEnabled: true,
            previewUnavailable: false,
          },
        })}
        onStop={vi.fn()}
        onSetPaused={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMark={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /pause recording/i }),
    ).toBeNull();
    screen.getByRole("button", { name: "Finish dictation" });
  });
});
