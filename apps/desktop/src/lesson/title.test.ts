import { describe, expect, it } from "vitest";

import { defaultLessonTitle, titleWithTopic } from "./title";

describe("lesson titles", () => {
  it("adds the topic to a lesson still named Lesson N", () => {
    expect(defaultLessonTitle(5)).toBe("Lesson 5");
    expect(titleWithTopic("Lesson 5", " 都 (all) and the weather ")).toBe(
      "Lesson 5 · 都 (all) and the weather",
    );
  });

  it("leaves a title someone chose, or a sheet with no topic", () => {
    expect(titleWithTopic("Chinese Grammar 都 and Negation", "都")).toBeNull();
    expect(titleWithTopic("Lesson 5 with Yan", "都")).toBeNull();
    expect(titleWithTopic("Lesson 5 · 都", "都 again")).toBeNull();
    expect(titleWithTopic("Lesson 5", "  ")).toBeNull();
  });
});
