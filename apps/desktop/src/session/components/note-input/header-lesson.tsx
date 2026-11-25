import { useLingui } from "@lingui/react/macro";

import { GraduationCap } from "@anlg/ui/components/icons";
import { Spinner } from "@anlg/ui/components/ui/spinner";

import { IconHeaderView } from "./header-shared";

import { useLessonSheetStatus } from "~/lesson/auto";

export function HeaderViewLesson({
  sessionId,
  isActive,
  onClick,
}: {
  sessionId: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useLingui();
  const writing = useLessonSheetStatus(
    (state) => state.bySession[sessionId]?.state === "writing",
  );
  return (
    <IconHeaderView
      isActive={isActive}
      label={t`Study sheet`}
      icon={
        writing ? (
          <Spinner className="size-3.5" />
        ) : (
          <GraduationCap className="size-3.5" />
        )
      }
      showIcon={writing}
      onClick={onClick}
    />
  );
}
