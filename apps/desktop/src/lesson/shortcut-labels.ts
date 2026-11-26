import { create } from "zustand";

/** Option-only keys come first; macOS may refuse them, so Control+Option is the fallback. */
export const MARK_SHORTCUT_SETS = [
  { keys: ["Alt+1", "Alt+2", "Alt+3"], labels: ["⌥1", "⌥2", "⌥3"] },
  {
    keys: ["Control+Alt+1", "Control+Alt+2", "Control+Alt+3"],
    labels: ["⌃⌥1", "⌃⌥2", "⌃⌥3"],
  },
] as const;

/** The labels of the keys that actually registered, for the board and the dialog. */
export const useMarkShortcutLabels = create<{ labels: readonly string[] }>(
  () => ({ labels: MARK_SHORTCUT_SETS[0].labels }),
);
