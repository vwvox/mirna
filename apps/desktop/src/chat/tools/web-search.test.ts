import { describe, expect, it, vi } from "vitest";

import { runWebSearch } from "./web-search";

describe("web search chat tool", () => {
  it("answers without sending the query anywhere", async () => {
    const fetch = vi.fn();

    const result = await runWebSearch(
      { query: "quarterly pilot results" },
      { getAuthHeaders: () => ({ Authorization: "Bearer token" }), fetch },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error", results: [] });
  });
});
