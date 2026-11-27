import { type LanguageModel, Output, streamText } from "ai";
import { z } from "zod";

import {
  commands as transcriptionCommands,
  type RenderedTranscriptSegment,
} from "@anlg/plugin-transcription";

import { loadLessonDocument, writeLessonDocument } from "./documents";
import {
  baseLanguageCode,
  languageFacts,
  languageName,
  readingRule,
} from "./languages";
import { renameLessonWithTopic } from "./queries";
import { type LessonRoleOf, lessonRoles, speakingMs } from "./roles";
import {
  lessonSubject,
  parseLessonMarks,
  parseLessonSheetDocument,
} from "./schema";
import {
  aiSubjectSheetSchema,
  NO_SUBJECT_PARTS,
  subjectSheetSystemPrompt,
  toSubjectSheet,
} from "./subject-sheet";
import { formatClock, parseClock } from "./time";
import type {
  LessonMarksDocument,
  LessonSettings,
  LessonSheet,
  LessonSubject,
  LessonTalkStats,
} from "./types";

import { liveQueryClient } from "~/db";
import { sha256Hex } from "~/session/attachments";
import { loadSessionContentSnapshot } from "~/session/content-queries";

const MAX_TRANSCRIPT_CHARS = 160_000;
const PROMPT_VERSION = "lesson-sheet-v4";
const SUBJECT_PROMPT_VERSION = "subject-sheet-v2";

const clock = z
  .string()
  .default("")
  .describe('Time in the recording as "mm:ss" or "h:mm:ss", or "" if unsure');

export const aiSheetSchema = z.object({
  topic: z
    .string()
    .default("")
    .describe(
      "2 to 6 words naming what the lesson covered, for its title, e.g. 都 (all) and the weather",
    ),
  summary: z
    .string()
    .default("")
    .describe("One sentence on what the student practised"),
  chapters: z
    .array(z.object({ title: z.string(), start: clock }))
    .default([])
    .describe("3 to 8 topics of the lesson in order, short titles"),
  vocabulary: z
    .array(
      z.object({
        term: z
          .string()
          .describe("Word or phrase in the language being learned, as written"),
        reading: z
          .string()
          .default("")
          .describe("The reading a learner needs, as the rules say, or empty"),
        meaning: z.string().default("").describe("Short meaning"),
        note: z
          .string()
          .default("")
          .describe('The word\'s type, short: "noun, f", "verb, irregular"'),
        heardAt: clock.describe("When the teacher first says it clearly"),
      }),
    )
    .default([]),
  patterns: z
    .array(
      z.object({
        pattern: z
          .string()
          .describe("The grammar pattern, e.g. Subject + 都 + verb"),
        explanation: z.string().default(""),
        examples: z
          .array(
            z.object({
              text: z
                .string()
                .describe("An example used in the lesson, as said"),
              translation: z.string().default(""),
              at: clock,
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  corrections: z
    .array(
      z.object({
        said: z.string().describe("What the student said"),
        corrected: z.string().describe("What the teacher said instead"),
        why: z.string().default(""),
        at: clock,
      }),
    )
    .default([]),
  homework: z
    .array(
      z.object({
        text: z.string(),
        due: z
          .string()
          .default("")
          .describe('When it is due as the teacher said it, or ""'),
        at: clock,
      }),
    )
    .default([]),
  markAnswers: z
    .array(
      z.object({
        markId: z.string(),
        answer: z
          .string()
          .describe(
            "What the lesson says about the marked moment: the explanation if the teacher gave one, or that it was not answered",
          ),
      }),
    )
    .default([]),
  openQuestions: z
    .array(z.string())
    .default([])
    .describe("The student's questions that the lesson did not answer"),
  translations: z
    .array(z.object({ text: z.string(), translation: z.string() }))
    .default([])
    .describe(
      "Up to 120 full sentences spoken in the language being learned, copied exactly from the transcript, each with a translation",
    ),
});

type AiSheet = z.infer<typeof aiSheetSchema>;

const SYSTEM_PROMPT = `You write study sheets for a student who records their language lessons.
The transcript comes from speech recognition, so expect misheard words; prefer what the context makes likely and leave out what you can't make sense of.
Lines are "[time] Speaker: text". "Teacher" is the teacher, "Student" is the student.
Write every explanation, meaning and translation in EXPLAIN_IN. Keep terms and examples in LEARNING exactly as written in the transcript.
Only include what actually happened in this lesson. Never invent vocabulary, corrections or homework.
- topic: what the lesson covered in a few words, with key terms in LEARNING.
- vocabulary: words and phrases the lesson taught or practised, most important first, at most 40.
  - reading: READING_RULE
  - note: the word's type in EXPLAIN_IN, in two or three words ("noun, f", "verb, irregular", "adjective", "phrase").ARTICLE_RULE
- patterns: grammar points the teacher explained, with examples taken from the lesson.
- corrections: times the teacher corrected what the student said (pronunciation, tones, word order, a missing word).
- homework: only tasks the teacher actually set.
- markAnswers: one entry for every mark id given, saying what happened around that moment.`;

// Providers without structured outputs (DeepSeek, most OpenAI-compatible
// servers) get plain JSON mode and never see the schema, and DeepSeek refuses
// JSON mode unless the prompt says "json". So the prompt carries both.
const OUTPUT_INSTRUCTIONS = `Reply with one JSON object and nothing else, matching this JSON schema:
${JSON.stringify(z.toJSONSchema(aiSheetSchema))}`;

/** The language sheet's instructions, for language codes ("es", "en"). */
export function lessonSheetSystemPrompt(
  learningCode: string,
  explainInCode: string,
) {
  const learning = languageName(learningCode);
  const explainIn = languageName(explainInCode);
  const articleRule = languageFacts(learningCode).articles
    ? `\n  - Give nouns with their article, as a learner should learn them (${ARTICLE_EXAMPLES[baseLanguageCode(learningCode)] ?? "la cocina, der Tisch"}).`
    : "";
  const instructions = SYSTEM_PROMPT.replace(
    /READING_RULE/g,
    readingRule(learningCode, learning),
  )
    .replace(/ARTICLE_RULE/g, articleRule)
    .replace(/LEARNING/g, learning)
    .replace(/EXPLAIN_IN/g, explainIn);
  return `${instructions}\n\n${OUTPUT_INSTRUCTIONS}`;
}

const ARTICLE_EXAMPLES: Record<string, string> = {
  es: "la cocina, el mercado",
  pt: "a cozinha, o mercado",
  fr: "la cuisine, le marché",
  it: "la cucina, il mercato",
  de: "die Küche, der Markt",
  nl: "de keuken, het brood",
  sv: "ett kök, en marknad",
  ga: "an chistin, an margadh",
  el: "η κουζίνα, η αγορά",
};

function speakerName(segment: RenderedTranscriptSegment, roleOf: LessonRoleOf) {
  const role = roleOf(segment);
  if (role === "student") return "Student";
  if (role === "teacher") return "Teacher";
  return segment.speaker_label || "Speaker";
}

export function formatLessonTranscript(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf = lessonRoles(segments, null),
): string {
  const lines: string[] = [];
  let length = 0;
  for (const segment of segments) {
    if (!segment.text.trim()) continue;
    const line = `[${formatClock(segment.start_ms)}] ${speakerName(segment, roleOf)}: ${segment.text.trim()}`;
    length += line.length + 1;
    if (length > MAX_TRANSCRIPT_CHARS) {
      lines.push("[transcript cut here for length]");
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function computeTalkStats(
  segments: RenderedTranscriptSegment[],
  roleOf: LessonRoleOf = lessonRoles(segments, null),
): LessonTalkStats | null {
  let studentMs = 0;
  let teacherMs = 0;
  for (const segment of segments) {
    const duration = speakingMs(segment);
    const role = roleOf(segment);
    if (role === "student") studentMs += duration;
    else if (role === "teacher") teacherMs += duration;
  }
  return studentMs + teacherMs > 0 ? { studentMs, teacherMs } : null;
}

export function toLessonSheet(
  ai: AiSheet,
  {
    knownTerms,
    talk,
    marks,
  }: {
    knownTerms: Set<string>;
    talk: LessonTalkStats | null;
    marks: LessonMarksDocument;
  },
): LessonSheet {
  const markIds = new Set(marks.marks.map((mark) => mark.id));
  const seen = new Set<string>();
  return {
    version: 1,
    kind: "language",
    ...NO_SUBJECT_PARTS,
    topic: ai.topic.trim().slice(0, 80),
    summary: ai.summary.trim(),
    chapters: ai.chapters
      .map((chapter) => ({
        title: chapter.title.trim(),
        startMs: parseClock(chapter.start),
      }))
      .filter(
        (chapter): chapter is { title: string; startMs: number } =>
          chapter.title.length > 0 && chapter.startMs !== null,
      )
      .sort((a, b) => a.startMs - b.startMs),
    vocabulary: ai.vocabulary
      .map((item) => ({
        term: item.term.trim(),
        reading: item.reading.trim(),
        meaning: item.meaning.trim(),
        note: item.note.trim(),
        heardAtMs: parseClock(item.heardAt),
        isNew: !knownTerms.has(item.term.trim()),
      }))
      .filter((item) => {
        if (!item.term || seen.has(item.term)) return false;
        seen.add(item.term);
        return true;
      }),
    patterns: ai.patterns
      .filter((pattern) => pattern.pattern.trim())
      .map((pattern) => ({
        pattern: pattern.pattern.trim(),
        explanation: pattern.explanation.trim(),
        examples: pattern.examples
          .filter((example) => example.text.trim())
          .map((example) => ({
            text: example.text.trim(),
            translation: example.translation.trim(),
            atMs: parseClock(example.at),
          })),
      })),
    corrections: ai.corrections
      .filter(
        (correction) => correction.said.trim() && correction.corrected.trim(),
      )
      .map((correction) => ({
        said: correction.said.trim(),
        corrected: correction.corrected.trim(),
        why: correction.why.trim(),
        atMs: parseClock(correction.at),
      })),
    homework: ai.homework
      .filter((item) => item.text.trim())
      .map((item) => ({
        text: item.text.trim(),
        due: item.due.trim(),
        atMs: parseClock(item.at),
      })),
    markAnswers: ai.markAnswers.filter(
      (answer) => markIds.has(answer.markId) && answer.answer.trim(),
    ),
    openQuestions: ai.openQuestions
      .map((question) => question.trim())
      .filter(Boolean),
    translations: ai.translations.filter(
      (item) => item.text.trim() && item.translation.trim(),
    ),
    talk,
  };
}

async function loadKnownTerms(sessionId: string, folderPath: string) {
  if (!folderPath) return new Set<string>();
  const rows = await liveQueryClient.execute<{ body: string }>(
    `
      SELECT document.body
      FROM session_documents AS document
      JOIN sessions AS session ON session.id = document.session_id
      WHERE session.folder_path = ? AND session.kind = 'lesson'
        AND session.id <> ? AND session.deleted_at IS NULL
        AND document.kind = 'lesson_sheet' AND document.deleted_at IS NULL
        -- Only lessons before this one: a word isn't "seen before" because a
        -- later lesson used it.
        AND COALESCE(NULLIF(session.started_at, ''), session.created_at) < (
          SELECT COALESCE(NULLIF(started_at, ''), created_at)
          FROM sessions WHERE id = ?
        )
    `,
    [folderPath, sessionId, sessionId],
  );
  const terms = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = parseLessonSheetDocument(JSON.parse(row.body));
      for (const item of parsed?.sheet.vocabulary ?? []) terms.add(item.term);
      for (const item of parsed?.sheet.keyTerms ?? []) terms.add(item.term);
    } catch {
      // Skip a sheet that can't be read.
    }
  }
  return terms;
}

export type LessonSheetInput = {
  sessionId: string;
  settings: LessonSettings;
  folderPath: string;
};

export type PreparedLessonSheet = {
  sourceHash: string;
  prompt: string;
  system: string;
  segments: RenderedTranscriptSegment[];
  studentHumanId: string | null;
  marks: LessonMarksDocument;
  subject?: LessonSubject;
};

export async function prepareLessonSheet({
  sessionId,
  settings,
}: LessonSheetInput): Promise<PreparedLessonSheet | null> {
  const [rendered, snapshot, marksDoc] = await Promise.all([
    transcriptionCommands.renderSessionTranscript({
      session_id: sessionId,
      self_human_id: null,
    }),
    loadSessionContentSnapshot(sessionId, { includeTranscriptWords: false }),
    loadLessonDocument(sessionId, "lesson_marks", parseLessonMarks),
  ]);
  if (rendered.status === "error") throw new Error(rendered.error);
  const segments = (rendered.data?.segments ?? []).filter(
    (segment) => segment.words.length > 0,
  );
  if (segments.length === 0) return null;

  const marks = marksDoc ?? { version: 1 as const, marks: [], questions: [] };
  const studentHumanId = snapshot?.ownerUserId || null;
  const transcript = formatLessonTranscript(
    segments,
    lessonRoles(segments, studentHumanId),
  );
  const subject = lessonSubject(settings);
  const learning = languageName(settings.learning);
  const explainIn = languageName(settings.explainIn);
  const context = {
    lesson: snapshot?.title ?? "",
    ...(subject === "language"
      ? { learning, explainIn }
      : { subject: settings.subjectName ?? "", classLanguage: learning }),
    studentNotes: snapshot?.rawMarkdown ?? "",
    marks: marks.marks.map((mark) => ({
      id: mark.id,
      kind: {
        important: "Marked as important",
        confused: "The student didn't understand this",
        homework: "Marked as homework",
      }[mark.kind],
      at: formatClock(mark.atMs),
      note: mark.note,
    })),
    questionsForLater: marks.questions.map((question) => question.text),
  };
  const prompt = `${JSON.stringify(context, null, 2)}\n\nTranscript:\n${transcript}`;
  const system =
    subject === "language"
      ? lessonSheetSystemPrompt(settings.learning, settings.explainIn)
      : subjectSheetSystemPrompt({
          subject,
          subjectName: settings.subjectName ?? "",
          classLanguage: learning,
          leaveOut: settings.leaveOut,
        });
  const version =
    subject === "language" ? PROMPT_VERSION : SUBJECT_PROMPT_VERSION;
  const sourceHash = await sha256Hex(
    new TextEncoder().encode(`${version}\n${system}\n${prompt}`)
      .buffer as ArrayBuffer,
  );
  return {
    sourceHash,
    prompt,
    system,
    segments,
    studentHumanId,
    marks,
    subject,
  };
}

// Thinking models spend their reasoning from the same budget, so a cap cuts
// the sheet off mid-JSON. Like the summary, leave it to the model's own limit;
// Anthropic alone requires one.
export function sheetMaxOutputTokens(model: LanguageModel): number | undefined {
  return typeof model !== "string" && model.provider.startsWith("anthropic")
    ? 64_000
    : undefined;
}

// Streamed, so a long answer keeps the connection busy instead of idling for
// minutes behind one response.
async function streamSheet<T>(
  {
    model,
    system,
    prompt,
    signal,
  }: {
    model: LanguageModel;
    system: string;
    prompt: string;
    signal?: AbortSignal;
  },
  schema: z.ZodType<T>,
): Promise<T> {
  let streamError: unknown;
  const result = streamText({
    model,
    system,
    prompt,
    output: Output.object({ schema }),
    maxRetries: 2,
    maxOutputTokens: sheetMaxOutputTokens(model),
    timeout: { totalMs: 240_000 },
    abortSignal: signal,
    onError: ({ error }) => {
      streamError ??= error;
    },
  });
  let output: T | undefined;
  try {
    output = (await result.output) as T;
  } catch (error) {
    throw streamError ?? error;
  }
  if (!output) throw new Error("The model returned no study sheet.");
  return output;
}

export async function generateLessonSheet({
  model,
  input,
  prepared,
  modelName,
  signal,
}: {
  model: LanguageModel;
  input: LessonSheetInput;
  prepared: PreparedLessonSheet;
  modelName: string;
  signal?: AbortSignal;
}): Promise<LessonSheet> {
  const knownTerms = await loadKnownTerms(input.sessionId, input.folderPath);
  const context = {
    knownTerms,
    talk: computeTalkStats(
      prepared.segments,
      lessonRoles(prepared.segments, prepared.studentHumanId),
    ),
    marks: prepared.marks,
  };
  const options = {
    model,
    system: prepared.system,
    prompt: prepared.prompt,
    signal,
  };
  const sheet =
    (prepared.subject ?? "language") === "language"
      ? toLessonSheet(await streamSheet(options, aiSheetSchema), context)
      : toSubjectSheet(
          await streamSheet(options, aiSubjectSheetSchema),
          context,
        );
  await writeLessonDocument(
    input.sessionId,
    "lesson_sheet",
    {
      sheet,
      generatedAt: new Date().toISOString(),
      model: modelName,
      sourceHash: prepared.sourceHash,
    },
    prepared.sourceHash,
  );
  await renameLessonWithTopic(input.sessionId, sheet.topic);
  return sheet;
}
