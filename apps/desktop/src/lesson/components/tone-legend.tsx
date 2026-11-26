import { useLingui } from "@lingui/react/macro";

import { cn } from "@anlg/utils";

import { toneClass } from "~/stt/pinyin";

const TONES = [
  { tone: 1, syllable: "mā" },
  { tone: 2, syllable: "má" },
  { tone: 3, syllable: "mǎ" },
  { tone: 4, syllable: "mà" },
  { tone: 0, syllable: "ma" },
] as const;

/** What each tone colour means, with "ma" in all five tones. */
export function ToneLegend({ className }: { className?: string }) {
  const { t } = useLingui();
  const names: Record<number, string> = {
    1: t`1st tone`,
    2: t`2nd tone`,
    3: t`3rd tone`,
    4: t`4th tone`,
    0: t`Neutral tone`,
  };
  return (
    <ul
      aria-label={t`Tone colours`}
      className={cn(["flex flex-wrap gap-x-3 gap-y-1 text-xs", className])}
    >
      {TONES.map(({ tone, syllable }) => (
        <li
          key={tone}
          title={names[tone]}
          className="flex items-baseline gap-1"
        >
          <span className={cn(["font-semibold", toneClass(tone)])}>
            {syllable}
          </span>
          <span className="text-muted-foreground">
            {tone === 0 ? t`neutral` : tone}
          </span>
        </li>
      ))}
    </ul>
  );
}
