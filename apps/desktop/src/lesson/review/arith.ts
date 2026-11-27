/**
 * Works out the sums the AI writes for new problems ("(190 - 172) / 8"), so
 * an answer shown in a review is never the AI's arithmetic. Numbers, + − × ÷,
 * powers, brackets and square roots only; anything else is refused.
 */
export function evaluateExpression(expression: string): number | null {
  const tokens = tokenize(expression);
  if (!tokens) return null;
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  function sum(): number | null {
    let left = product();
    while (left !== null && (peek() === "+" || peek() === "-")) {
      const op = take();
      const right = product();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function product(): number | null {
    let left = power();
    while (left !== null && (peek() === "*" || peek() === "/")) {
      const op = take();
      const right = power();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function power(): number | null {
    const base = unary();
    if (base === null) return null;
    if (peek() !== "^") return base;
    take();
    const exponent = power();
    if (exponent === null) return null;
    return base ** exponent;
  }

  function unary(): number | null {
    if (peek() === "-") {
      take();
      const value = unary();
      return value === null ? null : -value;
    }
    if (peek() === "+") {
      take();
      return unary();
    }
    return primary();
  }

  function primary(): number | null {
    const token = take();
    if (typeof token === "number") return token;
    if (token === "sqrt") {
      const value = primary();
      return value === null || value < 0 ? null : Math.sqrt(value);
    }
    if (token === "(") {
      const value = sum();
      if (take() !== ")") return null;
      return value;
    }
    return null;
  }

  const value = sum();
  if (value === null || index !== tokens.length || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

type Token = number | "+" | "-" | "*" | "/" | "^" | "(" | ")" | "sqrt";

function tokenize(expression: string): Token[] | null {
  const source = expression
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/√/g, " sqrt ")
    .replace(/\\sqrt/g, " sqrt ")
    .replace(/\\left|\\right/g, "")
    .replace(/[{[]/g, "(")
    .replace(/[}\]]/g, ")");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    const number = /^\d+(?:[.,]\d+)?/.exec(source.slice(index));
    if (number) {
      tokens.push(Number(number[0].replace(",", ".")));
      index += number[0].length;
      continue;
    }
    if (source.startsWith("sqrt", index)) {
      tokens.push("sqrt");
      index += 4;
      continue;
    }
    if ("+-*/^()".includes(char)) {
      tokens.push(char as Token);
      index++;
      continue;
    }
    return null;
  }
  return tokens.length > 0 ? tokens : null;
}

/** An answer as it is shown: up to three decimals, no trailing zeros. */
export function formatAnswer(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Whether a typed answer matches, allowing for rounding. */
export function answerMatches(typed: string, answer: number): boolean {
  const value = Number(
    typed
      .trim()
      .replace(",", ".")
      .replace(/[−–]/g, "-"),
  );
  if (!typed.trim() || !Number.isFinite(value)) return false;
  return Math.abs(value - answer) <= Math.max(0.005, Math.abs(answer) * 0.005);
}
