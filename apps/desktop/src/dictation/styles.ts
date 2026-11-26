import type { TargetApp, WritingStyle } from "@anlg/plugin-dictation";

export type AppCategory = "personal" | "work" | "email" | "other";

export const WRITING_STYLES: readonly WritingStyle[] = [
  "formal",
  "casual",
  "veryCasual",
];

// Matched on the bundle id, which is read on this device and never sent anywhere.
const CATEGORIES: Record<Exclude<AppCategory, "other">, ReadonlySet<string>> = {
  personal: new Set([
    "com.apple.MobileSMS",
    "net.whatsapp.WhatsApp",
    "desktop.WhatsApp",
    "ru.keepcoder.Telegram",
    "org.telegram.desktop",
    "org.whispersystems.signal-desktop",
    "com.facebook.archon",
    "com.hnc.Discord",
    "jp.naver.line.mac",
  ]),
  work: new Set([
    "com.tinyspeck.slackmacgap",
    "com.microsoft.teams2",
    "com.microsoft.teams",
    "com.mattermost.desktop",
    "us.zoom.xos",
  ]),
  email: new Set([
    "com.apple.mail",
    "com.microsoft.Outlook",
    "com.readdle.SparkDesktop",
    "com.readdle.smartemail-Mac",
    "com.superhuman.electron",
    "com.mimestream.Mimestream",
    "it.bloop.airmail2",
    "com.freron.MailMate",
    "org.mozilla.thunderbird",
  ]),
};

/** The kind of app a dictation goes into; anything unrecognized, browsers included, is other. */
export function appCategory(app: TargetApp | null | undefined): AppCategory {
  const id = app?.bundleId;
  if (!id) return "other";
  for (const [category, ids] of Object.entries(CATEGORIES))
    if (ids.has(id)) return category as AppCategory;
  return "other";
}

export function parseWritingStyle(value: string | undefined): WritingStyle {
  return WRITING_STYLES.includes(value as WritingStyle)
    ? (value as WritingStyle)
    : "formal";
}
