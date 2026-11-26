import { createContext, type ReactNode, useContext } from "react";

/**
 * The language a lesson teaches, for the words shown inside it. Null means
 * unknown (a lesson from before languages were set), where Chinese characters
 * still get pinyin as they always did.
 */
const LessonLanguage = createContext<string | null>(null);

export function LessonLanguageProvider({
  language,
  children,
}: {
  language: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <LessonLanguage.Provider value={language ?? null}>
      {children}
    </LessonLanguage.Provider>
  );
}

export function useLessonLanguage(): string | null {
  return useContext(LessonLanguage);
}
