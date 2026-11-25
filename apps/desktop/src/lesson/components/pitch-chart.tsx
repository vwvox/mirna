import { useLingui } from "@lingui/react/macro";

const WIDTH = 520;
const HEIGHT = 150;
const PAD = 14;
const RANGE = 7;

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
    const clamped = Math.max(-RANGE, Math.min(RANGE, value));
    const y = HEIGHT / 2 - (clamped / RANGE) * (HEIGHT / 2 - PAD);
    path += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    drawing = true;
  });
  return path.trim();
}

/** Teacher's pitch (solid) and the student's (dashed), each against its own median. */
export function PitchChart({
  teacher,
  student,
}: {
  teacher: Array<number | null>;
  student: Array<number | null> | null;
}) {
  const { t } = useLingui();
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="bg-mirna-paper dark:bg-background w-full rounded-lg border"
        role="img"
        aria-label={t`Pitch of the teacher's voice and yours over the word`}
      >
        {[-0.5, 0, 0.5].map((line) => (
          <line
            key={line}
            x1={PAD}
            x2={WIDTH - PAD}
            y1={HEIGHT / 2 - line * (HEIGHT - PAD * 2)}
            y2={HEIGHT / 2 - line * (HEIGHT - PAD * 2)}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        <path
          d={toPath(teacher)}
          fill="none"
          stroke="#2B5C9E"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {student ? (
          <path
            d={toPath(student)}
            fill="none"
            stroke="#B4532F"
            strokeWidth={3}
            strokeDasharray="7 6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      <figcaption className="text-muted-foreground flex gap-4 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0 w-5 border-t-[3px] border-[#2B5C9E]" />
          {t`Teacher`}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0 w-5 border-t-[3px] border-dashed border-[#B4532F]" />
          {t`You`}
        </span>
        <span>{t`Higher on the chart means a higher voice.`}</span>
      </figcaption>
    </figure>
  );
}
