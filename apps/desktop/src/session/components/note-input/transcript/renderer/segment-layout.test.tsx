import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptNoteProvider, useTranscriptNote } from "./note-context";
import {
  EMPTY_TRANSCRIPT_SEARCH,
  SegmentRenderer,
  type SegmentVariant,
  type TranscriptSearchRenderState,
} from "./segment";

import type { LessonSheet } from "~/lesson/types";
import type { Segment, SegmentWord } from "~/stt/live-segment";
import { type ChineseDisplay, useChineseDisplay } from "~/stt/pinyin";

const mocks = vi.hoisted(() => ({
  sheet: null as LessonSheet | null,
  updateTranscriptSegmentText: vi.fn(() => Promise.resolve()),
  splitTranscriptSpeaker: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lesson/queries", () => ({
  useLessonSession: () => ({
    isLesson: false,
    settings: null,
    folderPath: "",
  }),
  useLessonSheet: () =>
    mocks.sheet
      ? { sheet: mocks.sheet, generatedAt: "", model: "", sourceHash: "" }
      : null,
}));

vi.mock("./speaker-assign", () => ({
  SpeakerAssignPopover: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
  SpeakerParticipantPicker: () => null,
}));

vi.mock("~/stt/queries", () => ({
  updateTranscriptSegmentText: mocks.updateTranscriptSegmentText,
  splitTranscriptSpeaker: mocks.splitTranscriptSpeaker,
}));

const seekAndPlay = vi.fn();

beforeEach(() => {
  setDisplay({ mode: "characters", toneColours: false, translation: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.sheet = null;
  localStorage.clear();
});

describe("transcript row", () => {
  it("shows its time, speaker avatar and pause-separated paragraphs", () => {
    const view = renderSegment(
      createSegment([
        ["Hello", 1000, 1400],
        ["there.", 1400, 1900],
        ["Anyway,", 4000, 4400],
        ["moving", 4400, 4800],
        ["on.", 4800, 5200],
      ]),
      { currentMs: 61_500 },
    );

    expect(
      view.container
        .querySelector("time")
        ?.getAttribute("data-transcript-time"),
    ).toBe("01:01");
    expect(
      view.container
        .querySelector("[data-transcript-avatar]")
        ?.getAttribute("data-transcript-avatar"),
    ).toBe("R");
    expect(screen.getByRole("button", { name: "Rui" })).toBeTruthy();
    const paragraphs = view.container.querySelectorAll(
      "[data-transcript-segment-content] > p",
    );
    expect([...paragraphs].map((paragraph) => paragraph.textContent)).toEqual([
      "Hello there.",
      "Anyway, moving on.",
    ]);
    const section = view.container.querySelector("section")!;
    expect(section.dataset.transcriptPlaying).toBe("true");
    expect(section.className).toContain("bg-mirna-moss");
    expect(
      view.container.querySelector("[data-line-current='true']")?.className,
    ).toContain("bg-mirna-ipe");
  });

  it("plays from the start of the turn and copies its text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const segment = createSegment([
      ["你好", 0, 400],
      ["世界。", 400, 900],
    ]);
    renderSegment(segment);

    fireEvent.click(screen.getByRole("button", { name: "Play from here" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(seekAndPlay).toHaveBeenCalledWith(segment.words[0]);
    expect(writeText).toHaveBeenCalledWith("你好世界。");
  });

  it("shows a short reply as a compact chip", () => {
    const view = renderSegment(createSegment([["Yeah.", 0, 400]]), {
      variant: "chip",
    });

    const section = view.container.querySelector("section")!;
    expect(section.dataset.transcriptVariant).toBe("chip");
    expect(section.querySelector("time")).toBeNull();
    expect(screen.getByRole("button", { name: "Rui" })).toBeTruthy();
    expect(
      section.querySelector("[data-transcript-segment-content]")?.textContent,
    ).toBe("Yeah.");
  });
});

describe("Chinese display", () => {
  const sentence = () =>
    createSegment([
      ["我们", 0, 300],
      ["都", 300, 500],
      ["很好。", 500, 1000],
    ]);

  it("sets Chinese in a Chinese face, marked as Chinese", () => {
    const view = renderSegment(sentence());

    expect(
      [...view.container.querySelectorAll("[lang='zh-Hans']")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["我们", "都", "很好。"]);
  });

  it("puts pinyin above each character, in tone colours when asked", async () => {
    setDisplay({ mode: "pinyin-above", toneColours: true });
    const view = renderSegment(sentence());

    await waitFor(() =>
      expect(view.container.querySelectorAll("ruby")).toHaveLength(5),
    );
    const dou = [...view.container.querySelectorAll("ruby")].find(
      (ruby) => ruby.firstChild?.textContent === "都",
    )!;
    expect(dou.querySelector("rt")?.textContent).toBe("dōu");
    expect(dou.className).toContain("text-[#B4532F]");
  });

  it("shows pinyin instead of characters, keeping them in a tooltip", async () => {
    setDisplay({ mode: "pinyin-only" });
    const view = renderSegment(sentence());

    const content = view.container.querySelector(
      "[data-transcript-segment-content]",
    )!;
    await waitFor(() => expect(content.textContent).toContain("wǒmen dōu"));
    expect(content.textContent).not.toContain("我们");
    expect(content.textContent).toContain("hǎo. ");
    expect(
      content
        .querySelector("[data-transcript-word-id='word-0']")
        ?.getAttribute("title"),
    ).toBe("我们");
  });

  it("shows word columns with their meaning and opens a word card", async () => {
    mocks.sheet = createSheet();
    setDisplay({ mode: "word-by-word" });
    const segment = sentence();
    const view = renderSegment(segment, {}, "我们都很好。我们走吧");

    const column = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        "[data-han-word='我们']",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(column.textContent).toBe("我们wǒmenwe");
    expect(
      view.container.querySelector("[data-han-punctuation]")?.textContent,
    ).toBe("。");
    expect(
      column.querySelector("[data-transcript-word-id='word-0']")?.textContent,
    ).toBe("我们");

    fireEvent.click(column);

    expect(seekAndPlay).not.toHaveBeenCalled();
    const card = await waitFor(() => {
      const element = document.querySelector("[data-transcript-word-card]");
      expect(element).not.toBeNull();
      return element!;
    });
    // Untranslated plural messages aren't compiled in tests, so read the count.
    expect(
      card
        .querySelector("[data-transcript-heard-count]")
        ?.getAttribute("data-transcript-heard-count"),
    ).toBe("2");
    expect(card.textContent).toContain("wǒmen");
    expect(card.textContent).toContain("we");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(seekAndPlay).toHaveBeenCalledWith(segment.words[0]);
  });

  it("keeps click-to-seek outside word-by-word mode", () => {
    const segment = sentence();
    const view = renderSegment(segment);

    fireEvent.click(
      view.container.querySelector("[data-transcript-word-id='word-1']")!,
    );

    expect(seekAndPlay).toHaveBeenCalledWith(segment.words[1]);
  });

  it("shows the sheet's translation under the paragraph when switched on", () => {
    mocks.sheet = createSheet();
    const view = renderSegment(sentence());

    expect(view.container.querySelector("[data-transcript-translation]")).toBe(
      null,
    );

    act(() => setDisplay({ translation: true }));

    const translation = view.container.querySelector(
      "[data-transcript-translation]",
    );
    expect(translation?.textContent).toBe("We are all well.");
    expect(translation?.className).toContain("italic");
  });

  it("highlights Chinese words found by toneless pinyin", async () => {
    const view = renderSegment(sentence(), {
      search: { ...EMPTY_TRANSCRIPT_SEARCH, query: "dou" },
    });

    await waitFor(() =>
      expect(
        view.container.querySelector(
          "[data-transcript-word-id='word-1'] .bg-yellow-200\\/50",
        )?.textContent,
      ).toBe("都"),
    );
    expect(
      view.container.querySelector(
        "[data-transcript-word-id='word-0'] .bg-yellow-200\\/50",
      ),
    ).toBeNull();
  });
});

describe("edit mode", () => {
  it("shows Chinese without spaces and saves an edit to the words it touches", async () => {
    const view = renderSegment(
      createSegment([
        ["我们", 0, 300],
        ["都", 300, 500],
        ["很好。", 500, 1000],
      ]),
      { editMode: true },
    );
    const editor = view.container.querySelector<HTMLElement>(
      "[data-transcript-editor]",
    )!;

    expect(editor.textContent).toBe("我们都很好。");
    editor.textContent = "我们都很号。";
    fireEvent.blur(editor);

    await waitFor(() =>
      expect(mocks.updateTranscriptSegmentText).toHaveBeenCalledWith({
        transcriptId: "transcript-1",
        wordIds: ["word-0", "word-1", "word-2"],
        text: "我们 都 很号。",
      }),
    );
  });
});

function setDisplay(patch: Partial<ChineseDisplay>) {
  useChineseDisplay.getState().update(patch);
}

function NoteText({ text }: { text: string }) {
  const { registerText } = useTranscriptNote();
  useEffect(
    () => registerText("transcript-1", () => text),
    [registerText, text],
  );
  return null;
}

function renderSegment(
  segment: Segment,
  props: Partial<{
    currentMs: number;
    variant: SegmentVariant;
    search: TranscriptSearchRenderState;
    editMode: boolean;
  }> = {},
  noteText = "",
) {
  return render(
    <TranscriptNoteProvider
      sessionId="session-1"
      transcriptIds={["transcript-1"]}
    >
      <NoteText text={noteText} />
      <SegmentRenderer
        segment={segment}
        offsetMs={60_000}
        transcriptId="transcript-1"
        sessionId="session-1"
        speakerLabel="Rui"
        currentMs={props.currentMs ?? 0}
        seekAndPlay={seekAndPlay}
        audioExists
        search={props.search ?? EMPTY_TRANSCRIPT_SEARCH}
        editMode={props.editMode}
        variant={props.variant}
      />
    </TranscriptNoteProvider>,
  );
}

function createSegment(words: [string, number, number][]): Segment {
  const segmentWords: SegmentWord[] = words.map(
    ([text, start, end], index) => ({
      id: `word-${index}`,
      text,
      start_ms: start,
      end_ms: end,
      channel: "MixedCapture",
      is_final: true,
    }),
  );
  return {
    id: "segment-1",
    key: { channel: "MixedCapture", speaker_index: 1, speaker_human_id: null },
    start_ms: segmentWords[0]?.start_ms ?? 0,
    end_ms: segmentWords[segmentWords.length - 1]?.end_ms ?? 0,
    text: words.map(([text]) => text).join(" "),
    words: segmentWords,
  };
}

function createSheet(): LessonSheet {
  return {
    version: 1,
    topic: "",
    summary: "",
    chapters: [],
    vocabulary: [
      {
        term: "我们",
        reading: "wǒmen",
        meaning: "we",
        heardAtMs: null,
        isNew: true,
      },
    ],
    patterns: [],
    corrections: [],
    homework: [],
    markAnswers: [],
    openQuestions: [],
    translations: [{ text: "我们都很好", translation: "We are all well." }],
    talk: null,
  };
}
