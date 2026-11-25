import { useMemo } from "react";

import { cn } from "@anlg/utils";

import {
  CJK_FONT_STACK,
  hasHan,
  toneClass,
  usePinyinModule,
} from "~/stt/pinyin";

/** A word in the language being learned; Chinese characters take their tone colours. */
export function LessonTerm({
  term,
  className,
  toneColours = true,
}: {
  term: string;
  className?: string;
  toneColours?: boolean;
}) {
  const han = hasHan(term);
  const pinyin = usePinyinModule(han && toneColours);
  const parts = useMemo(() => {
    if (!pinyin || !han) return null;
    const items = pinyin.pinyin(term, { type: "all" }) as Array<{
      origin: string;
      num: number;
      isZh: boolean;
    }>;
    return items.map((item) => ({
      text: item.origin,
      tone: item.isZh ? item.num : null,
    }));
  }, [han, pinyin, term]);

  return (
    <span
      lang={han ? "zh-Hans" : undefined}
      className={cn([className])}
      style={han ? { fontFamily: CJK_FONT_STACK } : undefined}
    >
      {parts
        ? parts.map((part, index) => (
            <span
              key={index}
              className={part.tone === null ? undefined : toneClass(part.tone)}
            >
              {part.text}
            </span>
          ))
        : term}
    </span>
  );
}
