import { useLingui } from "@lingui/react/macro";

import { TONE_SHAPES, type ToneSyllable } from "../tones";

const WIDTH = 520;
const HEIGHT = 170;
const PAD = 14;
const TOP = 30;
const RANGE = 7;

const TONE_HEX: Record<number, string> = {
  0: "#666D68",
  1: "#B4532F",
  2: "#2F7A47",
  3: "#2B5C9E",
  4: "#7A3B8C",
};

function y(value: number) {
  const middle = TOP + (HEIGHT - TOP - PAD) / 2;
  const half = (HEIGHT - TOP - PAD) / 2;
  const clamped = Math.max(-RANGE, Math.min(RANGE, value));
  return middle - (clamped / RANGE) * half;
}

function toPath(values: Array<number | null>) {
  if (values.length < 2) return "";
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    const x = PAD + (index / (values.length - 1)) * (WIDTH - PAD * 2);
    path += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y(value).toFixed(1)} `;
    drawing = true;
  });
  return path.trim();
}

/**
 * The word's tones as their textbook shapes, one column per syllable, with the
 * teacher's pitch and yours drawn over them, each against its own middle voice.
 */
export function PitchChart({
  syllables,
  teacher,
  student,
}: {
  syllables: ToneSyllable[];
  teacher: Array<number | null> | null;
  student: Array<number | null> | null;
}) {
  const { t } = useLingui();
  const column = (WIDTH - PAD * 2) / Math.max(1, syllables.length);
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="bg-mirna-paper dark:bg-background w-full rounded-lg border"
        role="img"
        aria-label={t`The tones of the word, the teacher's pitch and yours`}
      >
        {syllables.map((syllable, index) => {
          const left = PAD + index * column;
          const path = TONE_SHAPES[syllable.spoken]
            .map(
              ([at, value], point) =>
                `${point === 0 ? "M" : "L"}${(left + column * (0.12 + at * 0.76)).toFixed(1)} ${y(value).toFixed(1)}`,
            )
            .join(" ");
          const colour = TONE_HEX[syllable.tone] ?? TONE_HEX[0]!;
          return (
            <g key={index}>
              {index > 0 ? (
                <line
                  x1={left}
                  x2={left}
                  y1={TOP - 6}
                  y2={HEIGHT - PAD}
                  className="stroke-border"
                  strokeWidth={1}
                />
              ) : null}
              <text
                x={left + column / 2}
                y={18}
                textAnchor="middle"
                fontSize={15}
                fontWeight={600}
                fill={colour}
              >
                {syllable.pinyin}
              </text>
              <path
                d={path}
                fill="none"
                stroke={colour}
                strokeOpacity={0.22}
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        {teacher ? (
          <path
            d={toPath(teacher)}
            fill="none"
            stroke="#8A918C"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {student ? (
          <path
            d={toPath(student)}
            fill="none"
            className="stroke-mirna-serra dark:stroke-mirna-moss"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2.5 w-5 rounded-full bg-[#2B5C9E]/25" />
          {t`Tone shape`}
        </span>
        {teacher ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0 w-5 border-t-[2.5px] border-[#8A918C]" />
            {t`Teacher`}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-2">
          <span className="border-mirna-serra dark:border-mirna-moss inline-block h-0 w-5 border-t-[3px]" />
          {t`You`}
        </span>
        <span>{t`Higher means a higher voice.`}</span>
      </figcaption>
    </figure>
  );
}
