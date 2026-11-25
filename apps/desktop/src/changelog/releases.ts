import { processContent } from "@anlg/changelog";

export type Release = {
  version: string;
  /** "YYYY-MM-DD", when it was released. */
  date: string | null;
  /** One plain sentence leading the notes. */
  summary: string | null;
  /** The notes, as Markdown. */
  content: string;
};

type Parsed = { core: number[]; pre: (string | number)[] } | null;

function parse(version: string): Parsed {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]
      ? match[4]
          .split(".")
          .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
  };
}

/**
 * Orders versions the semver way: 0.1.0-beta.10 comes after 0.1.0-beta.9,
 * and 0.1.0 after all of its betas. Versions that don't parse come first.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return left ? 1 : right ? -1 : a.localeCompare(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = left.core[index]! - right.core[index]!;
    if (diff !== 0) return diff;
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length;
  }
  for (
    let index = 0;
    index < Math.max(left.pre.length, right.pre.length);
    index += 1
  ) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Every release up to the one running, newest first. A version that isn't a
 * release (a local build reports 0.0.0) shows them all.
 */
export function releaseNotes(
  bundled: readonly { version: string; raw: string }[],
  current: string,
): Release[] {
  const known = bundled.some((release) => release.version === current);
  return bundled
    .filter(
      (release) =>
        parse(release.version) &&
        (!known || compareVersions(release.version, current) <= 0),
    )
    .map((release) => {
      const { content, date, summary } = processContent(release.raw);
      return { version: release.version, date, summary, content };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Came with this update: newer than the version before it, up to this one. */
export function isNewSince(
  version: string,
  previous: string | null,
  current: string,
): boolean {
  if (!previous || previous === current || !parse(previous)) return false;
  return (
    compareVersions(version, previous) > 0 &&
    compareVersions(version, current) <= 0
  );
}
