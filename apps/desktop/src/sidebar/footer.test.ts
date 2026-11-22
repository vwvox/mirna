import { describe, expect, it } from "vitest";

import { processingHeadline } from "./footer";

const step = (label: string, local: boolean) => ({ label, local });

describe("processingHeadline", () => {
  it("says where notes are processed", () => {
    expect(
      processingHeadline({
        transcription: step("Whisper", true),
        notes: step("Qwen 3.5", true),
        allLocal: true,
      }),
    ).toBe("local");
    expect(
      processingHeadline({
        transcription: step("Whisper", true),
        notes: step("DeepSeek", false),
        allLocal: false,
      }),
    ).toBe("notes-cloud");
    expect(
      processingHeadline({
        transcription: step("Deepgram", false),
        notes: step("Qwen 3.5", true),
        allLocal: false,
      }),
    ).toBe("transcription-cloud");
    expect(
      processingHeadline({ transcription: null, notes: null, allLocal: false }),
    ).toBe("unset");
  });
});
