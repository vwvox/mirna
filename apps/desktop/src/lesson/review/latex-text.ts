/**
 * A formula in plain text, for places that can't draw LaTeX: the phone, and
 * labels. `\frac{\sum (x - \bar{x})^2}{n - 1}` becomes `Σ(x − x̄)² / (n − 1)`.
 */
const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Omega: "Ω",
  sum: "Σ",
  prod: "Π",
  int: "∫",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  equiv: "≡",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  in: "∈",
  ldots: "…",
  cdots: "⋯",
  degree: "°",
  circ: "°",
  log: "log",
  ln: "ln",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  lim: "lim",
  max: "max",
  min: "min",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  n: "ⁿ",
  i: "ⁱ",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  i: "ᵢ",
  j: "ⱼ",
  n: "ₙ",
  x: "ₓ",
};

export function latexToText(latex: string): string {
  let source = latex.trim().replace(/^\$+|\$+$/g, "");
  let index = 0;

  function group(): string {
    while (source[index] === " ") index++;
    if (source[index] === "{") {
      index++;
      let depth = 1;
      const start = index;
      while (index < source.length && depth > 0) {
        if (source[index] === "{") depth++;
        else if (source[index] === "}") depth--;
        index++;
      }
      return convert(source.slice(start, index - 1));
    }
    if (source[index] === "\\") {
      const match = /^\\([a-zA-Z]+)/.exec(source.slice(index));
      if (match) {
        index += match[0].length;
        return SYMBOLS[match[1]!] ?? match[1]!;
      }
    }
    const char = source[index] ?? "";
    index++;
    return char;
  }

  function convert(part: string): string {
    const outerSource = source;
    const outerIndex = index;
    source = part;
    index = 0;
    let out = "";
    while (index < source.length) {
      const char = source[index]!;
      if (char === "\\") {
        const match = /^\\([a-zA-Z]+|.)/.exec(source.slice(index));
        const name = match?.[1] ?? "";
        index += match ? match[0].length : 1;
        if (name === "frac" || name === "dfrac" || name === "tfrac") {
          const top = group();
          const bottom = group();
          out += `${wrap(top)} / ${wrap(bottom)}`;
        } else if (name === "sqrt") {
          const inner = group();
          out += `√${wrap(inner)}`;
        } else if (name === "bar" || name === "overline") {
          out += combine(group(), "̄");
        } else if (name === "hat") {
          out += combine(group(), "̂");
        } else if (name === "tilde") {
          out += combine(group(), "̃");
        } else if (name === "vec") {
          out += combine(group(), "⃗");
        } else if (
          name === "text" ||
          name === "mathrm" ||
          name === "mathit" ||
          name === "mathbf" ||
          name === "operatorname"
        ) {
          out += group();
        } else if (
          name === "left" ||
          name === "right" ||
          name === "displaystyle"
        ) {
          // Sizes only.
        } else if (
          name === "," ||
          name === ";" ||
          name === " " ||
          name === "quad"
        ) {
          out += " ";
        } else if (
          name === "{" ||
          name === "}" ||
          name === "%" ||
          name === "$"
        ) {
          out += name;
        } else {
          out += SYMBOLS[name] ?? name;
        }
      } else if (char === "^" || char === "_") {
        index++;
        const inner = group();
        out += script(inner, char === "^" ? SUPERSCRIPT : SUBSCRIPT, char);
      } else if (char === "{" || char === "}") {
        index++;
      } else if (char === "-") {
        out += "−";
        index++;
      } else if (char === "*") {
        out += "×";
        index++;
      } else {
        out += char;
        index++;
      }
    }
    source = outerSource;
    index = outerIndex;
    return out;
  }

  return tidy(convert(source));
}

/** Text with `$…$` maths in it, the maths turned into plain text. */
export function inlineMathToText(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (_, maths: string) => latexToText(maths));
}

function wrap(part: string): string {
  const trimmed = part.trim();
  return /^[\p{L}\p{N}.]+$/u.test(trimmed) || /^\(.*\)$/.test(trimmed)
    ? trimmed
    : `(${trimmed})`;
}

/** A combining mark (a bar, a hat) over the last letter. */
function combine(base: string, mark: string): string {
  return `${base.trim()}${mark}`;
}

function script(
  part: string,
  table: Record<string, string>,
  sign: "^" | "_",
): string {
  const trimmed = part.trim();
  const chars = [...trimmed];
  if (chars.length > 0 && chars.every((char) => table[char])) {
    return chars.map((char) => table[char]).join("");
  }
  return `${sign}${wrap(trimmed)}`;
}

function tidy(text: string): string {
  return text
    .replace(/\s*=\s*/g, " = ")
    .replace(/\s+/g, " ")
    .trim();
}
