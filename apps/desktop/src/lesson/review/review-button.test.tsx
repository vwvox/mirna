import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sheet: null as unknown,
  plan: { data: null as unknown, isLoading: true },
  request: vi.fn(() => Promise.resolve()),
}));

vi.mock("../queries", () => ({ useLessonSheet: () => state.sheet }));
vi.mock("../documents", () => ({ useLessonDocument: () => null }));
vi.mock("./document", () => ({ useReviewPlanQuery: () => state.plan }));
vi.mock("./auto", () => ({
  requestReviewPlan: state.request,
  useReviewPlanStatus: (
    select: (value: { bySession: Record<string, string> }) => unknown,
  ) => select({ bySession: {} }),
}));
vi.mock("./review-player", () => ({ ReviewPlayer: () => null }));
vi.mock("~/ai/hooks", () => ({ useLanguageModel: () => "model" }));

import { ReviewButton } from "./review-button";

describe("the Review button", () => {
  beforeEach(() => {
    state.sheet = { sheet: {} };
    state.plan = { data: null, isLoading: true };
    state.request.mockClear();
  });
  afterEach(cleanup);

  it("waits for the stored plan before asking for one", () => {
    const view = render(<ReviewButton sessionId="lesson-1" title="Lesson" />);
    expect(state.request).not.toHaveBeenCalled();

    state.plan = { data: null, isLoading: false };
    view.rerender(<ReviewButton sessionId="lesson-1" title="Lesson" />);
    expect(state.request).toHaveBeenCalledWith("lesson-1", "model");
  });

  it("leaves a lesson that has a plan alone", () => {
    state.plan = {
      data: { plan: { pieces: [] }, sourceHash: "", generatedAt: "" },
      isLoading: false,
    };
    render(<ReviewButton sessionId="lesson-1" title="Lesson" />);
    expect(state.request).not.toHaveBeenCalled();
  });
});
