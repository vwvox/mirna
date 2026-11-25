import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { Brain, GraduationCap } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { useAllLessonIds, usePracticeDue } from "../practice-data";
import { LessonPracticeDialog } from "./practice-dialog";

import { useLiveQuery } from "~/db";
import { useFolderSelection } from "~/folders/selection";
import { useTabs } from "~/store/zustand/tabs";

type CourseRow = { folder_path: string; lessons: number };

const COURSES_SQL = `
  SELECT folder_path, COUNT(*) AS lessons
  FROM sessions
  WHERE kind = 'lesson' AND deleted_at IS NULL AND folder_path <> ''
  GROUP BY folder_path
  ORDER BY MAX(COALESCE(NULLIF(started_at, ''), created_at)) DESC
`;

export function useCourses() {
  const { data = [] } = useLiveQuery<CourseRow, CourseRow[]>({
    sql: COURSES_SQL,
    params: [],
    mapRows: (rows) => rows,
  });
  return data;
}

export function openCourse(folderPath: string) {
  useFolderSelection.getState().setSelectedPath(folderPath);
  useTabs.getState().openCurrent({ type: "folders" });
}

function courseName(folderPath: string) {
  return folderPath.split("/").pop() || folderPath;
}

/** The courses that have lessons, each opening its course page. */
export function SidebarCourses() {
  const { t } = useLingui();
  const courses = useCourses();
  const onFolders = useTabs((state) => state.currentTab?.type === "folders");
  const selected = useFolderSelection((state) => state.selectedPath);
  const lessonIds = useAllLessonIds();
  const practice = usePracticeDue(lessonIds);
  const [practising, setPractising] = useState(false);
  if (courses.length === 0) return null;

  return (
    <nav aria-label={t`Courses`} className="-mx-1 flex flex-col">
      <span className="text-muted-foreground px-2 pt-1 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
        <Trans>Courses</Trans>
      </span>
      {courses.map((course) => {
        const current = onFolders && selected === course.folder_path;
        return (
          <button
            key={course.folder_path}
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={() => openCourse(course.folder_path)}
            className={cn([
              "flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13.5px] font-medium transition-colors",
              current
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
            ])}
          >
            <GraduationCap size={16} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {courseName(course.folder_path)}
            </span>
            <span className="text-muted-foreground font-mono text-[11px] font-normal">
              {course.lessons}
            </span>
          </button>
        );
      })}
      {practice.cards > 0 ? (
        <button
          type="button"
          onClick={() => setPractising(true)}
          className={cn([
            "flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13.5px] font-medium transition-colors",
            "text-muted-foreground hover:bg-accent hover:text-foreground",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
          ])}
        >
          <Brain size={16} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <Trans>Practise</Trans>
          </span>
          <span
            aria-label={t`${practice.due} words due`}
            className={cn([
              "rounded-pill px-1.5 font-mono text-[11px]",
              practice.due > 0
                ? "bg-mirna-moss text-mirna-serra dark:bg-mirna-serra/40 dark:text-mirna-mist font-semibold"
                : "font-normal",
            ])}
          >
            {practice.due}
          </span>
        </button>
      ) : null}
      {practising ? (
        <LessonPracticeDialog
          sessionIds={lessonIds}
          title={t`All your lessons`}
          onClose={() => setPractising(false)}
        />
      ) : null}
    </nav>
  );
}
