import { describe, expect, it } from "vitest";

import {
  describeNotesModel,
  describeTranscription,
  modelFamily,
  summarizeProcessingLocation,
} from "./processing-location";

describe("processing location", () => {
  it("names local engines by what they are", () => {
    expect(describeTranscription("local_file", "local-file")).toEqual({
      label: "Whisper",
      local: true,
    });
    expect(describeNotesModel("ollama", "qwen3.5-4b-32k")).toEqual({
      label: "Qwen 3.5",
      local: true,
    });
  });

  it("names cloud engines by provider and marks them not local", () => {
    expect(describeNotesModel("deepseek", "deepseek-flash")).toEqual({
      label: "DeepSeek",
      local: false,
    });
    expect(describeTranscription("deepgram", "nova-3")?.local).toBe(false);
  });

  it("is all-local only when every configured step runs on this Mac", () => {
    const whisper = describeTranscription("local_file", "local-file");
    expect(
      summarizeProcessingLocation(
        whisper,
        describeNotesModel("ollama", "qwen3.5"),
      ).allLocal,
    ).toBe(true);
    expect(
      summarizeProcessingLocation(
        whisper,
        describeNotesModel("deepseek", "deepseek-flash"),
      ).allLocal,
    ).toBe(false);
    expect(summarizeProcessingLocation(null, null).allLocal).toBe(false);
  });

  it("shortens model ids to their family", () => {
    expect(modelFamily("gemma4:e4b")).toBe("Gemma 4");
    expect(modelFamily("llama")).toBe("Llama");
  });
});
