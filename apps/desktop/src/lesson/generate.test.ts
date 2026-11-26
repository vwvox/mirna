import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeLessonDocument: vi.fn(async () => {}),
}));

vi.mock("@anlg/plugin-transcription", () => ({ commands: {} }));
vi.mock("./documents", () => ({
  loadLessonDocument: vi.fn(),
  writeLessonDocument: mocks.writeLessonDocument,
}));
vi.mock("~/db", () => ({ liveQueryClient: { execute: async () => [] } }));
vi.mock("~/session/attachments", () => ({ sha256Hex: vi.fn() }));
vi.mock("~/session/content-queries", () => ({
  loadSessionContentSnapshot: vi.fn(),
}));

import { generateLessonSheet, type PreparedLessonSheet } from "./generate";

const answer = JSON.stringify({
  summary: "Practised 都 with negation.",
  vocabulary: [
    { term: "都", reading: "dōu", meaning: "all", heardAt: "02:21" },
  ],
});

// A model that answers only by streaming, in small pieces, as DeepSeek does
// once the request asks for a stream.
function streamingModel(text: string) {
  const pieces = text.match(/.{1,12}/gsu) ?? [];
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          ...pieces.map((delta) => ({
            type: "text-delta" as const,
            id: "t",
            delta,
          })),
          { type: "text-end" as const, id: "t" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: {
              inputTokens: {
                total: 4,
                noCache: 4,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 2, text: 2, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
}

const prepared: PreparedLessonSheet = {
  sourceHash: "hash",
  prompt: "transcript",
  system: "system",
  segments: [],
  studentHumanId: null,
  marks: { version: 1, marks: [], questions: [] },
};

describe("writing the study sheet", () => {
  afterEach(() => vi.clearAllMocks());

  it("saves the sheet from a streamed answer", async () => {
    const sheet = await generateLessonSheet({
      model: streamingModel(answer),
      input: {
        sessionId: "lesson-1",
        settings: { learning: "zh", explainIn: "en" },
        folderPath: "",
      },
      prepared,
      modelName: "deepseek-flash",
    });

    expect(sheet.summary).toBe("Practised 都 with negation.");
    expect(sheet.vocabulary[0]).toMatchObject({
      term: "都",
      heardAtMs: 141_000,
    });
    expect(sheet.homework).toEqual([]);
    expect(mocks.writeLessonDocument).toHaveBeenCalledWith(
      "lesson-1",
      "lesson_sheet",
      expect.objectContaining({ model: "deepseek-flash", sourceHash: "hash" }),
      "hash",
    );
  });

  it("reports a cut-off answer instead of saving part of it", async () => {
    await expect(
      generateLessonSheet({
        model: streamingModel(answer.slice(0, 40)),
        input: {
          sessionId: "lesson-1",
          settings: { learning: "zh", explainIn: "en" },
          folderPath: "",
        },
        prepared,
        modelName: "deepseek-flash",
      }),
    ).rejects.toThrow();
    expect(mocks.writeLessonDocument).not.toHaveBeenCalled();
  });
});
