import { Trans } from "@lingui/react/macro";

const WIDTH = 264;
const HEIGHT = 56;
const GAP = 3;

/** Grows from left to right: one point per lesson. */
function Line({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  const points = values
    .map((value, index) => {
      const x = values.length > 1 ? index * step : WIDTH / 2;
      const y = HEIGHT - 4 - (value / max) * (HEIGHT - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        className="stroke-mirna-serra dark:stroke-mirna-moss"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One bar per lesson out of 100, the latest one darker. */
function Bars({
  values,
  label,
  tone,
}: {
  values: Array<number | null>;
  label: string;
  tone: "serra" | "terra";
}) {
  const width =
    (WIDTH - GAP * (values.length - 1)) / Math.max(1, values.length);
  const light = tone === "terra" ? "#E8C3B3" : "#BFCDBA";
  const dark = tone === "terra" ? "#B4532F" : "#2E4A3B";
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {values.map((value, index) => {
        const height =
          value === null ? 2 : Math.max(2, (value / 100) * (HEIGHT - 2));
        return (
          <rect
            key={index}
            x={index * (width + GAP)}
            y={HEIGHT - height}
            width={width}
            height={height}
            rx={2}
            fill={
              value === null
                ? "#E4E1D6"
                : index === values.length - 1
                  ? dark
                  : light
            }
          />
        );
      })}
    </svg>
  );
}

export function ProgressCard({
  title,
  value,
  detail,
  chart,
}: {
  title: string;
  value: string;
  detail?: string;
  chart:
    | { kind: "line"; values: number[]; label: string }
    | {
        kind: "bars";
        values: Array<number | null>;
        label: string;
        tone: "serra" | "terra";
      };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border px-4 py-3">
      <span className="text-muted-foreground text-xs font-medium">{title}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-brand text-mirna-serra dark:text-mirna-moss text-2xl leading-none font-medium">
          {value}
        </span>
        {detail ? (
          <span className="text-muted-foreground truncate text-xs">
            {detail}
          </span>
        ) : null}
      </div>
      {chart.kind === "line" ? (
        <Line values={chart.values} label={chart.label} />
      ) : (
        <Bars values={chart.values} label={chart.label} tone={chart.tone} />
      )}
      <div className="text-muted-foreground flex justify-between text-[11px]">
        <span>
          <Trans>Lesson 1</Trans>
        </span>
        <span>{chart.values.length}</span>
      </div>
    </div>
  );
}
