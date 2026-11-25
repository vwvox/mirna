import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { compareVersions, isNewSince, releaseNotes } from "./releases";

const note = (version: string, date: string, summary: string) => ({
  version,
  raw: `---\ndate: "${date}"\nsummary: "${summary}"\n---\n\n- Something for ${version}.\n`,
});

describe("release notes", () => {
  it("orders betas by number and a release after its betas", () => {
    const versions = [
      "0.1.0",
      "0.1.0-beta.10",
      "0.1.0-beta.2",
      "0.2.0-beta.1",
      "0.1.0-beta.9",
    ];
    expect([...versions].sort(compareVersions)).toEqual([
      "0.1.0-beta.2",
      "0.1.0-beta.9",
      "0.1.0-beta.10",
      "0.1.0",
      "0.2.0-beta.1",
    ]);
  });

  it("lists every release up to this one, newest first", () => {
    const notes = releaseNotes(
      [
        note("0.1.0-beta.1", "2026-11-22", "First"),
        note("0.1.0-beta.3", "2026-11-23", "Third"),
        note("0.1.0-beta.2", "2026-11-23", "Second"),
        note("0.1.0-beta.4", "2026-11-25", "Not out yet"),
      ],
      "0.1.0-beta.3",
    );
    expect(notes.map((release) => release.version)).toEqual([
      "0.1.0-beta.3",
      "0.1.0-beta.2",
      "0.1.0-beta.1",
    ]);
    expect(notes[0]).toMatchObject({
      date: "2026-11-23",
      summary: "Third",
      content: "- Something for 0.1.0-beta.3.",
    });
  });

  it("shows them all in a build whose version isn't a release", () => {
    const notes = releaseNotes(
      [
        note("0.1.0-beta.1", "2026-11-22", "A"),
        note("0.1.0-beta.2", "2026-11-23", "B"),
      ],
      "0.0.0",
    );
    expect(notes).toHaveLength(2);
  });

  it("marks what came with this update, even across skipped versions", () => {
    expect(isNewSince("0.1.0-beta.4", "0.1.0-beta.2", "0.1.0-beta.4")).toBe(
      true,
    );
    expect(isNewSince("0.1.0-beta.3", "0.1.0-beta.2", "0.1.0-beta.4")).toBe(
      true,
    );
    expect(isNewSince("0.1.0-beta.2", "0.1.0-beta.2", "0.1.0-beta.4")).toBe(
      false,
    );
    // Opened from Settings, or with no earlier version known: nothing is new.
    expect(isNewSince("0.1.0-beta.4", "0.1.0-beta.4", "0.1.0-beta.4")).toBe(
      false,
    );
    expect(isNewSince("0.1.0-beta.4", null, "0.1.0-beta.4")).toBe(false);
  });

  it("has a date and a summary in every note Mirna ships", () => {
    const dir = resolve(
      __dirname,
      "../../../../packages/changelog/content/mirna",
    );
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".md") && file !== "AGENTS.md",
    );
    expect(files.length).toBeGreaterThan(0);
    const notes = releaseNotes(
      files.map((file) => ({
        version: file.slice(0, -3),
        raw: readFileSync(resolve(dir, file), "utf-8"),
      })),
      "0.0.0",
    );
    expect(notes).toHaveLength(files.length);
    for (const release of notes) {
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.summary, release.version).toBeTruthy();
      expect(release.content.trim(), release.version).not.toBe("");
    }
  });
});
