import "katex/dist/katex.min.css";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@anlg/utils";

type Katex = (typeof import("katex"))["default"];

let loaded: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** KaTeX is only fetched once a sheet has maths in it. */
function loadKatex(): Promise<Katex> {
  loading ??= import("katex").then((module) => {
    loaded = module.default;
    return loaded;
  });
  return loading;
}

function useKatex(enabled = true): Katex | null {
  const [katex, setKatex] = useState<Katex | null>(loaded);
  useEffect(() => {
    if (!enabled || katex) return;
    let live = true;
    void loadKatex().then((module) => {
      if (live) setKatex(module);
    });
    return () => {
      live = false;
    };
  }, [enabled, katex]);
  return katex;
}

export type RenderedLatex = { html: string } | { error: string };

export function renderLatex(
  katex: Katex,
  latex: string,
  display: boolean,
): RenderedLatex {
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode: display,
        throwOnError: true,
        strict: "ignore",
        output: "htmlAndMathml",
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A formula drawn from LaTeX. LaTeX KaTeX can't read shows as the text it is,
 * with `onBroken` told, so the sheet can offer a fix instead of a blank.
 */
export function Formula({
  latex,
  display = false,
  className,
  label,
  onBroken,
}: {
  latex: string;
  display?: boolean;
  className?: string;
  /** Read aloud instead of the LaTeX, when given. */
  label?: string;
  onBroken?: (broken: boolean) => void;
}) {
  const katex = useKatex();
  const rendered = useMemo(
    () => (katex ? renderLatex(katex, latex, display) : null),
    [display, katex, latex],
  );
  const broken = rendered !== null && "error" in rendered;
  useEffect(() => {
    onBroken?.(broken);
  }, [broken, onBroken]);

  if (!rendered || "error" in rendered) {
    return (
      <code
        className={cn([
          "font-mono text-sm break-all",
          broken && "text-mirna-terra",
          className,
        ])}
        title={broken ? rendered.error : undefined}
      >
        {latex}
      </code>
    );
  }
  return (
    <span
      className={cn([
        display ? "block [&_.katex-display]:m-0" : "",
        className,
      ])}
      aria-label={label}
      // KaTeX escapes the LaTeX it is given; its output is markup it built.
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}

export type MathPiece =
  | { kind: "text"; text: string }
  | { kind: "math"; latex: string; display: boolean };

/**
 * Splits text at $…$ (inline) and $$…$$ (on its own line). A $ followed by a
 * space, or a closing $ followed by a digit, is money ("$10"), not maths.
 */
export function splitMath(text: string): MathPiece[] {
  const pieces: MathPiece[] = [];
  const pattern = /\$\$([^$]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) pieces.push({ kind: "text", text: text.slice(last, start) });
    const display = match[1] !== undefined;
    pieces.push({
      kind: "math",
      latex: (match[1] ?? match[2] ?? "").trim(),
      display,
    });
    last = start + match[0].length;
  }
  if (last < text.length) pieces.push({ kind: "text", text: text.slice(last) });
  return pieces;
}

/** Text with $…$ maths in it, as the subject sheet's steps and problems are written. */
export function MathText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const pieces = useMemo(() => splitMath(text), [text]);
  if (pieces.every((piece) => piece.kind === "text")) {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {pieces.map((piece, index) =>
        piece.kind === "text" ? (
          <span key={index}>{piece.text}</span>
        ) : (
          <Formula key={index} latex={piece.latex} display={piece.display} />
        ),
      )}
    </span>
  );
}
