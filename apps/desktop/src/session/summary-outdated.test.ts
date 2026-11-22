import { describe, expect, it } from "vitest";

import { isSummaryOutdated } from "./summary-outdated";

describe("isSummaryOutdated", () => {
  it("is outdated when the transcript was redone after the summary", () => {
    expect(
      isSummaryOutdated({
        marked_at: "2026-11-22T13:56:55.000Z",
        summary_at: "2026-11-22T11:28:56.000Z",
      }),
    ).toBe(true);
  });

  it("clears itself once the summary is written or edited again", () => {
    expect(
      isSummaryOutdated({
        marked_at: "2026-11-22T13:56:55.000Z",
        summary_at: "2026-11-22T14:02:10.000Z",
      }),
    ).toBe(false);
  });

  it("is never outdated without a mark", () => {
    expect(isSummaryOutdated(null)).toBe(false);
    expect(
      isSummaryOutdated({ marked_at: null, summary_at: "2026-11-22T11:00Z" }),
    ).toBe(false);
  });
});
