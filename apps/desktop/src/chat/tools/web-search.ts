import { tool } from "ai";
import { z } from "zod";

import type { ToolDependencies, WebSearchResponse } from "./types";

const webSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query for public web information."),
  includeDomains: z.array(z.string().min(1)).max(5).optional(),
  excludeDomains: z.array(z.string().min(1)).max(5).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

// Web search went through the vendor's hosted research endpoint, which would
// send the user's query (and often meeting context) off the device. Mirna keeps
// the tool's shape so chat tooling still type-checks, but never makes the call.
export async function runWebSearch(
  params: WebSearchInput,
  _deps: Pick<ToolDependencies, "getAuthHeaders" | "fetch">,
): Promise<WebSearchResponse> {
  return {
    status: "error",
    message: "Web search is not available in Mirna; answers use local notes only.",
    query: params.query,
    results: [],
  };
}

export const buildWebSearchTool = (deps: ToolDependencies) =>
  tool({
    description:
      "Web search is unavailable in Mirna. Do not call this tool; answer from local notes, meetings, contacts and calendar events instead.",
    inputSchema: webSearchInputSchema,
    execute: (params) => runWebSearch(params, deps),
  });
