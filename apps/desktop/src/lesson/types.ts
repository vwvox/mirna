export const LESSON_MARK_KINDS = ["important", "confused", "homework"] as const;
export type LessonMarkKind = (typeof LESSON_MARK_KINDS)[number];

export type LessonMark = {
  id: string;
  kind: LessonMarkKind;
  /** Position in the note's audio, so it lines up with playback. */
  atMs: number;
  note: string;
  createdAt: string;
};

export type LessonQuestion = {
  id: string;
  text: string;
  atMs: number | null;
  asked: boolean;
  createdAt: string;
};

export type LessonMarksDocument = {
  version: 1;
  marks: LessonMark[];
  questions: LessonQuestion[];
};

export const LESSON_SUBJECTS = ["language", "topic", "maths"] as const;
/** The kind of class: a language, a topic (key terms and ideas) or maths and science (formulas). */
export type LessonSubject = (typeof LESSON_SUBJECTS)[number];

export const SUBJECT_SECTIONS = [
  "keyTerms",
  "ideas",
  "sources",
  "methods",
  "checkYourself",
  "formulas",
  "workedExamples",
  "slips",
  "problems",
] as const;
export type SubjectSection = (typeof SUBJECT_SECTIONS)[number];

/**
 * Language codes, as used by the transcription settings ("zh", "en", "pt"). For
 * topics and maths, `learning` and `explainIn` are both the class's language.
 */
export type LessonSettings = {
  learning: string;
  explainIn: string;
  /** Missing on lessons set up before subjects, which are all language lessons. */
  subject?: LessonSubject;
  /** What a topic or maths class is about ("Contract law"), to steer the sheet. */
  subjectName?: string;
  /** Sections unticked when the lesson was set up. */
  leaveOut?: SubjectSection[];
};

export type LessonVocabularyItem = {
  term: string;
  /** Pinyin for Chinese, kana for Japanese, a transliteration for other scripts, empty for Latin letters. */
  reading: string;
  meaning: string;
  /** The word's type, short: "noun, f", "verb, irregular", "phrase". */
  note: string;
  heardAtMs: number | null;
  isNew: boolean;
};

export type LessonKeyTerm = {
  term: string;
  /** In the teacher's words. */
  definition: string;
  heardAtMs: number | null;
  isNew: boolean;
};

export type LessonIdea = {
  title: string;
  explanation: string;
  /** The example used in class, if any. */
  example: string;
  exampleAtMs: number | null;
  /** Key terms the idea uses. */
  terms: string[];
};

export const SOURCE_KINDS = [
  "person",
  "book",
  "case",
  "law",
  "study",
  "other",
] as const;
export type LessonSourceKind = (typeof SOURCE_KINDS)[number];

export type LessonSource = {
  name: string;
  kind: LessonSourceKind;
  /** As said: "1893", "1858 to 1917", or empty. */
  year: string;
  /** Why it came up. */
  note: string;
  atMs: number | null;
};

export type LessonStep = { text: string; atMs: number | null };

/** A method, procedure or recipe the class walked through. */
export type LessonMethod = {
  title: string;
  atMs: number | null;
  steps: LessonStep[];
};

export type LessonQuestionItem = {
  question: string;
  answer: string;
  atMs: number | null;
};

export type LessonFormulaSymbol = { symbol: string; meaning: string };

export type LessonFormula = {
  name: string;
  /** LaTeX, without $ signs. */
  latex: string;
  symbols: LessonFormulaSymbol[];
  whenToUse: string;
  atMs: number | null;
  /** Rebuilt from what was said, or taken from the student's notes. */
  from: "speech" | "notes";
};

export type LessonWorkedExample = {
  problem: string;
  atMs: number | null;
  /** Each step's text may hold $…$ maths. */
  steps: LessonStep[];
  answer: string;
};

export type LessonProblem = {
  question: string;
  answer: string;
  /** Steps to show one at a time; may hold $…$ maths. */
  steps: string[];
  atMs: number | null;
};

export type LessonExample = {
  text: string;
  translation: string;
  atMs: number | null;
};

export type LessonPattern = {
  pattern: string;
  explanation: string;
  examples: LessonExample[];
};

export type LessonCorrection = {
  said: string;
  corrected: string;
  why: string;
  atMs: number | null;
};

export type LessonHomework = {
  text: string;
  /** As the teacher said it ("Thursday", "next class"), or empty. */
  due: string;
  atMs: number | null;
};

export type LessonChapter = {
  title: string;
  startMs: number;
};

export type LessonTranslation = {
  text: string;
  translation: string;
};

export type LessonTalkStats = {
  studentMs: number;
  teacherMs: number;
};

export type LessonSheet = {
  version: 1;
  /** Language sheets have words and patterns; subject sheets (topics, maths) the rest. */
  kind: "language" | "subject";
  /** A few words on what the lesson covered; empty on sheets written before topics. */
  topic: string;
  summary: string;
  chapters: LessonChapter[];
  vocabulary: LessonVocabularyItem[];
  patterns: LessonPattern[];
  /** On subject sheets: common slips, by the student or the class. */
  corrections: LessonCorrection[];
  homework: LessonHomework[];
  markAnswers: { markId: string; answer: string }[];
  openQuestions: string[];
  translations: LessonTranslation[];
  talk: LessonTalkStats | null;
  keyTerms: LessonKeyTerm[];
  ideas: LessonIdea[];
  sources: LessonSource[];
  methods: LessonMethod[];
  checkYourself: LessonQuestionItem[];
  formulas: LessonFormula[];
  workedExamples: LessonWorkedExample[];
  problems: LessonProblem[];
};

/** The student's own fixes to formulas the AI rebuilt, kept apart so writing the sheet again never undoes them. */
export type LessonFixesDocument = {
  version: 1;
  /** By formula name. `latex` is what the student checked or typed. */
  formulas: Record<string, { latex: string; at: string }>;
};

export type LessonSheetDocument = {
  sheet: LessonSheet;
  generatedAt: string;
  model: string;
  sourceHash: string;
};

export type LessonCardState = {
  due: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string;
};

export type LessonPracticeDocument = {
  version: 1;
  cards: Record<string, LessonCardState>;
  /** Words of this lesson's sheet the student chose not to practise. */
  skipped?: string[];
  /** Recent tone checks, one per syllable said, newest last. */
  toneChecks?: LessonToneCheck[];
  /** Reviews played, on the Mac or the phone, oldest first. */
  reviews?: LessonReviewRecord[];
};

/** A review once played, kept with the lesson's practice. */
export type LessonReviewRecord = {
  id: string;
  startedAt: string;
  endedAt: string;
  length: 5 | 10;
  device: "mac" | "phone";
  right: number;
  total: number;
  results: {
    pieceId: string;
    kind: string;
    outcome: "missed" | "shaky" | "knew";
  }[];
};

export type LessonToneCheck = { tone: number; ok: boolean; at: string };
