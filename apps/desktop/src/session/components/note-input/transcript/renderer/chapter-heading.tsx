import { formatTranscriptTime } from "./utils";

import type { LessonChapter } from "~/lesson/types";

/** A lesson chapter's title over the row where it begins. */
export function ChapterHeading({ chapter }: { chapter: LessonChapter }) {
  return (
    <div
      data-transcript-chapter
      className="flex items-baseline gap-3 px-2 pt-5 pb-2"
    >
      <time
        dateTime={`PT${Math.floor(Math.max(0, chapter.startMs) / 1000)}S`}
        className="text-muted-foreground w-12 shrink-0 text-right font-mono text-[11px] tabular-nums"
      >
        {formatTranscriptTime(chapter.startMs)}
      </time>
      <h3 className="font-brand text-foreground min-w-0 shrink text-[20px] leading-7 font-medium wrap-break-word">
        {chapter.title}
      </h3>
      <div
        aria-hidden
        className="border-border/60 min-w-6 flex-1 self-center border-t"
      />
    </div>
  );
}
