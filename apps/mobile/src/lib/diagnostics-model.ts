// Pure helpers for the phone's problem log (no React Native imports, so they
// run under node's test runner). The log holds what happened and what went
// wrong, never what was said or written: no titles, notes or transcripts.

export type DiagnosticLevel = "info" | "warning" | "error";

export type DiagnosticValue = string | number | boolean | null;

export type DiagnosticDetail = Record<string, DiagnosticValue | undefined>;

export type DiagnosticEntry = {
  at: string;
  level: DiagnosticLevel;
  event: string;
  detail?: Record<string, DiagnosticValue>;
};

const MAX_VALUE_CHARS = 300;
const MAX_DETAIL_KEYS = 24;

/** Lines kept when the log is trimmed. */
export const DIAGNOSTICS_KEEP_LINES = 1500;
/** The log is trimmed once it grows past this. */
export const DIAGNOSTICS_MAX_BYTES = 384 * 1024;

function clean(value: string): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").trim();
  return flat.length > MAX_VALUE_CHARS
    ? `${flat.slice(0, MAX_VALUE_CHARS)}…`
    : flat;
}

export function cleanDetail(
  detail: DiagnosticDetail | undefined,
): Record<string, DiagnosticValue> | undefined {
  if (!detail) return undefined;
  const out: Record<string, DiagnosticValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    if (count >= MAX_DETAIL_KEYS) break;
    count += 1;
    if (typeof value === "string") out[clean(key)] = clean(value);
    else if (typeof value === "number")
      out[clean(key)] = Number.isFinite(value) ? value : null;
    else out[clean(key)] = value;
  }
  return count > 0 ? out : undefined;
}

/** The parts of an error worth keeping: its kind, message and code. */
export function errorDetail(error: unknown): Record<string, DiagnosticValue> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      error: clean(`${error.name}: ${error.message}`),
      ...(typeof code === "string" || typeof code === "number"
        ? { code: String(code) }
        : {}),
    };
  }
  if (typeof error === "string") return { error: clean(error) };
  if (error === null || error === undefined) return {};
  try {
    return { error: clean(JSON.stringify(error)) };
  } catch {
    return { error: clean(String(error)) };
  }
}

export function diagnosticLine(
  event: string,
  level: DiagnosticLevel,
  detail: DiagnosticDetail | undefined,
  now: Date,
): string {
  const entry: DiagnosticEntry = {
    at: now.toISOString(),
    level,
    event: clean(event),
  };
  const cleaned = cleanDetail(detail);
  if (cleaned) entry.detail = cleaned;
  return `${JSON.stringify(entry)}\n`;
}

/** The last `keep` lines of a log, so it never grows without end. */
export function keepRecentLines(text: string, keep: number): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const kept = lines.slice(Math.max(0, lines.length - keep));
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

export function parseDiagnostics(text: string): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as DiagnosticEntry;
      if (typeof value?.event === "string" && typeof value.at === "string") {
        entries.push(value);
      }
    } catch {
      // A line cut short by a crash: skip it.
    }
  }
  return entries;
}

/** One line of the log for people: "14:02:11  recording_saved  minutes=62". */
export function describeEntry(entry: DiagnosticEntry): string {
  const details = entry.detail
    ? Object.entries(entry.detail)
        .map(([key, value]) => `${key}=${value}`)
        .join("  ")
    : "";
  const level = entry.level === "info" ? "" : ` [${entry.level}]`;
  return `${entry.event}${level}${details ? `  ${details}` : ""}`;
}

/** The text of an exported log: who and what it came from, then the log. */
export function exportText(input: {
  header: Record<string, string>;
  log: string;
}): string {
  const header = Object.entries(input.header)
    .map(([key, value]) => `# ${key}: ${clean(value)}`)
    .join("\n");
  return `${header}\n#\n${input.log}`;
}
