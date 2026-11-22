// Pure helpers for the phone's link to the Mac (no React Native imports, so
// they run under node's test runner).

export type MacLinkState =
  | "waiting" // not on the Mac yet
  | "sending"
  | "on_mac" // all audio arrived, waiting its turn
  | "transcribing"
  | "summarizing"
  | "done"
  | "failed"; // the Mac could not make a note of it

export type MacLinkStatus = {
  state: MacLinkState;
  sent_bytes?: number;
  total_bytes?: number;
  error?: string | null;
  mac_session_id?: string | null;
  updated_at?: string;
};

export function parseMacLink(raw: string | null | undefined): MacLinkStatus {
  if (!raw) return { state: "waiting" };
  try {
    const parsed = JSON.parse(raw) as MacLinkStatus;
    return parsed && typeof parsed.state === "string"
      ? parsed
      : { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}

export function describeMacLink(status: MacLinkStatus, macName?: string) {
  const mac = macName || "your Mac";
  switch (status.state) {
    case "waiting":
      return `Waiting for ${mac}`;
    case "sending": {
      const total = status.total_bytes ?? 0;
      const percent =
        total > 0
          ? Math.min(99, Math.floor(((status.sent_bytes ?? 0) / total) * 100))
          : 0;
      return `Sending to ${mac} · ${percent}%`;
    }
    case "on_mac":
      return `On ${mac} · waiting to transcribe`;
    case "transcribing":
      return `Transcribing on ${mac}`;
    case "summarizing":
      return `Summarizing on ${mac}`;
    case "done":
      return `Transcribed on ${mac}`;
    case "failed":
      return status.error || `${mac} could not transcribe this recording`;
  }
}

// Recordings made in the app are 16 kHz mono 16-bit WAV.
export function wavDurationMs(filename: string, bytes: number): number | null {
  if (!filename.toLowerCase().endsWith(".wav") || bytes <= 44) return null;
  return Math.round(((bytes - 44) / (16_000 * 2)) * 1000);
}

type PmNode = {
  type?: string;
  text?: string;
  attrs?: { level?: number; checked?: boolean };
  content?: PmNode[];
};

/** Plain Markdown from the note editor's document: enough for the Mac's summary. */
export function proseMirrorToMarkdown(node: PmNode, depth = 0): string {
  const children = (separator: string, childDepth = depth) =>
    (node.content ?? [])
      .map((child) => proseMirrorToMarkdown(child, childDepth))
      .filter((text) => text.length > 0)
      .join(separator);
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, node.attrs?.level ?? 1)))} ${children("")}`;
    case "paragraph":
      return children("");
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (node.content ?? [])
        .map((item, index) => {
          const marker =
            node.type === "orderedList"
              ? `${index + 1}.`
              : node.type === "taskList"
                ? item.attrs?.checked
                  ? "- [x]"
                  : "- [ ]"
                : "-";
          const body = (item.content ?? [])
            .map((child) => proseMirrorToMarkdown(child, depth + 1))
            .filter(Boolean)
            .join("\n");
          return `${"  ".repeat(depth)}${marker} ${body}`;
        })
        .join("\n");
    case "blockquote":
      return children("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    default:
      return children(depth === 0 ? "\n\n" : "\n");
  }
}
