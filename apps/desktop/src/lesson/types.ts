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

/** Language codes, as used by the transcription settings ("zh", "en", "pt"). */
export type LessonSettings = {
  learning: string;
  explainIn: string;
};

export type LessonVocabularyItem = {
  term: string;
  /** Pinyin for Chinese, a romanisation for other scripts, empty when none applies. */
  reading: string;
  meaning: string;
  heardAtMs: number | null;
  isNew: boolean;
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
  /** A few words on what the lesson covered; empty on sheets written before topics. */
  topic: string;
  summary: string;
  chapters: LessonChapter[];
  vocabulary: LessonVocabularyItem[];
  patterns: LessonPattern[];
  corrections: LessonCorrection[];
  homework: LessonHomework[];
  markAnswers: { markId: string; answer: string }[];
  openQuestions: string[];
  translations: LessonTranslation[];
  talk: LessonTalkStats | null;
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
};
