import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { CaretDown } from "@anlg/ui/components/icons";

import { useCourseLessons } from "../queries";

/** Whether a folder holds lessons, so its page is a course. */
export function useIsCourse(folderPath: string): boolean {
  return useCourseLessons(folderPath).length > 0;
}

/**
 * On a course, the folder's own settings (sharing, context for the AI,
 * materials) fold away under Course settings; other folders show them as before.
 */
export function CourseSettingsFold({
  folderPath,
  children,
}: {
  folderPath: string;
  children: ReactNode;
}) {
  const isCourse = useIsCourse(folderPath);
  if (!isCourse) return <>{children}</>;
  return (
    <details className="group bg-mirna-mist/60 dark:bg-card rounded-2xl border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <Trans>Course settings</Trans>
        <span className="text-muted-foreground text-sm font-normal">
          <Trans>Context for the AI, materials and sharing</Trans>
        </span>
        <CaretDown
          aria-hidden
          className="text-muted-foreground ml-auto size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-6 border-t px-5 pt-4 pb-5">
        {children}
      </div>
    </details>
  );
}
