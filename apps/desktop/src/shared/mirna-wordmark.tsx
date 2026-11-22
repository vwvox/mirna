import { cn } from "@anlg/utils";

const MIST_STROKE = "calc(1px + 0.022em)";

const MIST_STROKES = [
  { d: "M4 8 C 30 3, 52 13, 82 8", className: "stroke-mirna-sage" },
  { d: "M96 8 C 112 5, 128 11, 148 8", className: "stroke-mirna-terra" },
  { d: "M162 8 C 190 3, 214 13, 246 8", className: "stroke-mirna-sage" },
];

/** The mist line under the wordmark: sage, one stroke of red earth, sage. */
export function MirnaMist({
  className,
  strokeWidth = MIST_STROKE,
}: {
  className?: string;
  strokeWidth?: string;
}) {
  return (
    <svg
      viewBox="0 0 250 16"
      aria-hidden="true"
      className={cn(["overflow-visible", className])}
      fill="none"
      strokeLinecap="round"
    >
      {MIST_STROKES.map((stroke) => (
        <path
          key={stroke.d}
          d={stroke.d}
          className={stroke.className}
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth }}
        />
      ))}
    </svg>
  );
}

/** Mirna's in-app wordmark. Outside the app (Dock, menu bar) Mirna uses the icon instead. */
export function MirnaWordmark({
  className,
  mist = true,
  align = "center",
}: {
  className?: string;
  mist?: boolean;
  align?: "center" | "start";
}) {
  return (
    <span
      role="img"
      aria-label="Mirna"
      className={cn([
        "inline-flex flex-col leading-none whitespace-nowrap select-none",
        align === "start" ? "items-start" : "items-center",
        className,
      ])}
    >
      <span
        aria-hidden="true"
        className="font-brand text-mirna-wordmark tracking-[-0.015em]"
      >
        m
        <span className="relative inline-block">
          ı
          <span className="bg-mirna-ipe absolute top-[0.06em] left-1/2 size-[0.19em] -translate-x-1/2 rounded-full" />
        </span>
        rna
      </span>
      {mist ? <MirnaMist className="mt-[0.04em] h-[0.17em] w-[2.6em]" /> : null}
    </span>
  );
}
