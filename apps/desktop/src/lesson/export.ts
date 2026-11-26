import { downloadDir, join } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";

import { commands as fs2Commands } from "@anlg/plugin-fs2";

import type {
  LessonFormula,
  LessonSheet,
  LessonVocabularyItem,
} from "./types";

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

export type CardExportItem = {
  front: string;
  back: string;
  lesson: string;
};

/**
 * Anki cards from a subject sheet. Formulas keep their LaTeX between \( and \),
 * which Anki draws with its own MathJax.
 */
export function subjectCardItems(
  sheet: Pick<LessonSheet, "keyTerms" | "checkYourself" | "problems">,
  formulas: readonly Pick<LessonFormula, "name" | "latex" | "whenToUse">[],
  lesson: string,
): CardExportItem[] {
  return [
    ...sheet.keyTerms.map((item) => ({
      front: item.term,
      back: item.definition,
      lesson,
    })),
    ...formulas.map((formula) => ({
      front: formula.name,
      back: [`\\(${formula.latex}\\)`, formula.whenToUse]
        .filter(Boolean)
        .join(" · "),
      lesson,
    })),
    ...sheet.checkYourself.map((item) => ({
      front: item.question,
      back: item.answer,
      lesson,
    })),
    ...sheet.problems
      .filter((problem) => problem.answer)
      .map((problem) => ({
        front: dollarsToAnki(problem.question),
        back: dollarsToAnki(problem.answer),
        lesson,
      })),
  ].filter((item) => item.front && item.back);
}

/** $x^2$ in sheet text becomes \(x^2\), Anki's way of marking maths. */
export function dollarsToAnki(text: string): string {
  return text
    .replace(/\$\$([^$]+?)\$\$/g, "\\[$1\\]")
    .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, "\\($1\\)");
}

export function buildCardsAnkiText(items: CardExportItem[]): string {
  const lines = ["#separator:tab", "#html:false", "#tags column:3"];
  for (const item of items) {
    const tag = clean(item.lesson).replace(/\s+/g, "_") || "mirna";
    lines.push([clean(item.front), clean(item.back), tag].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export async function exportCards(
  items: CardExportItem[],
  baseName: string,
): Promise<string | null> {
  const safeName = baseName.replace(/[/\\:*?"<>|]+/g, "-").trim() || "Lesson";
  const path = await save({
    defaultPath: await join(await downloadDir(), `${safeName} (Anki).txt`),
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (!path) return null;
  const result = await fs2Commands.writeTextFile(
    path,
    buildCardsAnkiText(items),
  );
  if (result.status === "error") throw new Error(result.error);
  return path;
}

/** A subject sheet as Markdown, maths kept as $…$, for notes apps. */
export function buildSubjectMarkdown(
  title: string,
  sheet: LessonSheet,
  formulas: readonly Pick<LessonFormula, "name" | "latex" | "whenToUse">[],
): string {
  const out: string[] = [`# ${title}`, ""];
  if (sheet.summary) out.push(sheet.summary, "");
  const section = (heading: string, lines: string[]) => {
    if (lines.length === 0) return;
    out.push(`## ${heading}`, "", ...lines, "");
  };
  section(
    "Formulas",
    formulas.map(
      (formula) =>
        `- **${formula.name}**: $${formula.latex}$${formula.whenToUse ? ` — ${formula.whenToUse}` : ""}`,
    ),
  );
  section(
    "Key terms",
    sheet.keyTerms.map((item) => `- **${item.term}**: ${item.definition}`),
  );
  section(
    "Main ideas",
    sheet.ideas.flatMap((idea) => [
      `- **${idea.title}** ${idea.explanation}`.trim(),
      ...(idea.example ? [`  - Example: ${idea.example}`] : []),
    ]),
  );
  section(
    "People and sources",
    sheet.sources.map(
      (source) =>
        `- **${source.name}**${source.year ? ` (${source.year})` : ""}: ${source.note}`,
    ),
  );
  for (const method of sheet.methods) {
    section(
      method.title,
      method.steps.map((step, index) => `${index + 1}. ${step.text}`),
    );
  }
  section(
    "Worked examples",
    sheet.workedExamples.flatMap((example) => [
      `- ${example.problem}`,
      ...example.steps.map((step, index) => `  ${index + 1}. ${step.text}`),
      ...(example.answer ? [`  - Answer: ${example.answer}`] : []),
    ]),
  );
  section(
    "Common slips",
    sheet.corrections.map(
      (slip) =>
        `- ~~${slip.said}~~ → ${slip.corrected}${slip.why ? ` (${slip.why})` : ""}`,
    ),
  );
  section(
    "Check yourself",
    sheet.checkYourself.map((item) => `- ${item.question} — ${item.answer}`),
  );
  section(
    "Practice problems",
    sheet.problems.map((problem) => `- ${problem.question}`),
  );
  section(
    "Homework",
    sheet.homework.map(
      (item) => `- [ ] ${item.text}${item.due ? ` (${item.due})` : ""}`,
    ),
  );
  return `${out.join("\n").trim()}\n`;
}

/** Formulas as a LaTeX list, for pasting into a document. */
export function buildFormulaLatex(
  title: string,
  formulas: readonly Pick<LessonFormula, "name" | "latex">[],
): string {
  const items = formulas.map(
    (formula) => `  \\item ${formula.name}: \\[ ${formula.latex} \\]`,
  );
  return `\\section*{${title}}\n\\begin{itemize}\n${items.join("\n")}\n\\end{itemize}\n`;
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
