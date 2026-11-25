import { useLingui } from "@lingui/react/macro";
import { useId } from "react";

import { CaretDown, Check } from "@anlg/ui/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@anlg/ui/components/ui/popover";
import { Switch } from "@anlg/ui/components/ui/switch";
import { cn } from "@anlg/utils";

import { ToneLegend } from "~/lesson/components/tone-legend";
import { useLessonSession, useLessonSheet } from "~/lesson/queries";
import {
  CHINESE_DISPLAY_MODES,
  type ChineseDisplay,
  type ChineseDisplayMode,
  useChineseDisplay,
  useEffectiveChineseDisplay,
} from "~/stt/pinyin";

/** How Chinese in the transcript reads: characters, pinyin, word by word, tone colours and translations. */
export function ChineseDisplayMenu({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const isLesson = useLessonSession(sessionId).isLesson;
  const shown = useEffectiveChineseDisplay(isLesson);
  const save = useChineseDisplay((state) => state.update);
  // Saves what the note shows plus the change, so picking one option doesn't
  // drop the lesson default's other choices.
  const display = {
    ...shown,
    update: (patch: Partial<ChineseDisplay>) => save({ ...shown, ...patch }),
  };
  const hasTranslations =
    (useLessonSheet(sessionId)?.sheet.translations.length ?? 0) > 0;
  const toneId = useId();
  const translationId = useId();
  const labels: Record<ChineseDisplayMode, string> = {
    characters: t`Characters`,
    "pinyin-above": t`Pinyin above`,
    "word-by-word": t`Word by word`,
    "pinyin-only": t`Pinyin only`,
  };
  const customised = display.mode !== "characters" || display.toneColours;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn([
            "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5",
            customised
              ? "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-mist font-semibold"
              : "border-border hover:text-foreground border font-medium",
          ])}
        >
          {t`Display`}
          <CaretDown aria-hidden size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="app"
        align="end"
        sideOffset={6}
        className="w-60 p-1.5 text-sm"
      >
        <div
          role="radiogroup"
          aria-label={t`Chinese text`}
          className="flex flex-col"
        >
          {CHINESE_DISPLAY_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={display.mode === mode}
              onClick={() => display.update({ mode })}
              className="hover:bg-accent flex items-center justify-between rounded-md px-2 py-1.5 text-left"
            >
              {labels[mode]}
              {display.mode === mode ? (
                <Check aria-hidden className="size-3.5" />
              ) : null}
            </button>
          ))}
        </div>
        <div className="bg-border my-1.5 h-px" />
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <label htmlFor={toneId}>{t`Tone colours`}</label>
          <Switch
            id={toneId}
            size="sm"
            checked={display.toneColours}
            onCheckedChange={(toneColours) => display.update({ toneColours })}
          />
        </div>
        {display.toneColours ? <ToneLegend className="px-2 pb-1.5" /> : null}
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <label
            htmlFor={translationId}
            className={cn([!hasTranslations && "text-muted-foreground"])}
          >
            {t`Translation`}
          </label>
          <Switch
            id={translationId}
            size="sm"
            disabled={!hasTranslations}
            checked={hasTranslations && display.translation}
            onCheckedChange={(translation) => display.update({ translation })}
          />
        </div>
        {hasTranslations ? null : (
          <p className="text-muted-foreground px-2 pb-1 text-xs">
            {t`Translations come from a lesson's study sheet.`}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
