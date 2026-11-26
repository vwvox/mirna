import { downloadDir, join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";

import { commands as fs2Commands } from "@anlg/plugin-fs2";

import type { LessonVocabularyItem } from "./types";

export type VocabularyExportFormat = "anki" | "pleco";

function clean(value: string) {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Anki's text import: tab-separated, with header lines that tell Anki the separator,
 * that fields are plain text and which column holds tags.
 */
export function buildAnkiText(
  items: Array<LessonVocabularyItem & { lesson: string }>,
): string {
  const lines = ["#separator:tab", "#html:false", "#tags column:4"];
  for (const item of items) {
    const back = [item.reading, item.meaning].filter(Boolean).join(" · ");
    const tag = clean(item.lesson).replace(/\s+/g, "_") || "mirna";
    lines.push([clean(item.term), clean(back), "", tag].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/** Pleco's flashcard import: headword, pinyin and definition, one card per line. */
export function buildPlecoText(items: LessonVocabularyItem[]): string {
  return `${items
    .map((item) =>
      [clean(item.term), clean(item.reading), clean(item.meaning)].join("\t"),
    )
    .join("\n")}\n`;
}

export async function exportVocabulary(
  format: VocabularyExportFormat,
  items: Array<LessonVocabularyItem & { lesson: string }>,
  baseName: string,
): Promise<string | null> {
  const safeName = baseName.replace(/[/\\:*?"<>|]+/g, "-").trim() || "Lesson";
  const fileName = `${safeName} (${format === "anki" ? "Anki" : "Pleco"}).txt`;
  const path = await save({
    defaultPath: await join(await downloadDir(), fileName),
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (!path) return null;
  const content =
    format === "anki" ? buildAnkiText(items) : buildPlecoText(items);
  const result = await fs2Commands.writeTextFile(path, content);
  if (result.status === "error") throw new Error(result.error);
  return path;
}
