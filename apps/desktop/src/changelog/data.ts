import { useMemo } from "react";
// @ts-ignore virtual module provided by the Vite changelog plugin
import { releases } from "virtual:changelog";

import { type Release, releaseNotes } from "./releases";

/** Release notes bundled with this build, newest first, up to `current`. */
export function useReleaseNotes(current: string): Release[] {
  return useMemo(
    () => releaseNotes(releases as { version: string; raw: string }[], current),
    [current],
  );
}
