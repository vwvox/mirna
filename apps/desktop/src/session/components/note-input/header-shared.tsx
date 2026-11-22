import { json2md, parseJsonContent } from "@anlg/editor/markdown";
import { toast } from "@anlg/ui/components/ui/toast";
import { cn } from "@anlg/utils";

export function getStoredNoteMarkdown(content: string | undefined) {
  const trimmed = content?.trim() ?? "";

  if (!trimmed) {
    return "";
  }

  if (!trimmed.startsWith("{")) {
    return trimmed;
  }

  return json2md(parseJsonContent(trimmed)).trim();
}

const UUID_TITLE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TITLE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function IconHeaderView({
  isActive,
  label,
  hoverLabel,
  icon,
  suffixIcon,
  pressed,
  onClick,
  onContextMenu,
  title,
  size = "tray",
  className,
  showIcon = false,
}: {
  isActive: boolean;
  label: string;
  /** Icons only show when they carry status (live, transcribing). */
  showIcon?: boolean;
  hoverLabel?: string;
  icon: React.ReactNode;
  suffixIcon?: React.ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
  size?: "tray" | "standalone";
  className?: string;
}) {
  return (
    <button
      data-main-area-window-drag-region
      data-tauri-drag-region="false"
      type="button"
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      aria-pressed={pressed}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      data-hover-label={hoverLabel}
      className={iconHeaderViewClassName(
        isActive,
        size,
        cn([
          "max-w-48 gap-1.5",
          hoverLabel
            ? "after:hidden after:min-w-0 after:truncate after:text-xs after:font-medium after:content-[attr(data-hover-label)] hover:after:block"
            : null,
          className,
        ]),
      )}
    >
      {showIcon ? icon : null}
      <span
        className={cn([
          "min-w-0 truncate",
          hoverLabel ? "group-hover/header-view:hidden" : null,
        ])}
      >
        {label}
      </span>
      {isActive ? suffixIcon : null}
    </button>
  );
}

export function iconHeaderViewClassName(
  isActive: boolean,
  size: "tray" | "standalone" = "tray",
  className?: string,
) {
  void size;

  return cn([
    "group/header-view -mb-px flex h-9 shrink-0 items-center justify-center border-b-2 px-0.5 text-sm transition-colors select-none [&>svg]:shrink-0",
    "focus-visible:text-foreground focus-visible:outline-hidden",
    isActive
      ? "border-mirna-serra text-mirna-wordmark dark:border-mirna-sage font-semibold"
      : "text-muted-foreground hover:text-foreground border-transparent font-medium",
    className,
  ]);
}

export function getEnhancedNoteTitle({
  rawTitle,
  templateTitle,
  templateId,
}: {
  rawTitle: unknown;
  templateTitle: string | null;
  templateId: string | undefined;
}) {
  if (templateTitle) {
    return templateTitle;
  }

  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) {
    return "Summary";
  }

  const isGeneratedTitle =
    title === "Summary" ||
    title === templateId ||
    UUID_TITLE_RE.test(title) ||
    ISO_TITLE_RE.test(title);

  if (isGeneratedTitle) {
    return "Summary";
  }

  return title;
}

export async function copyTextToClipboard(
  text: string,
  messages?: {
    success: string;
    error: string;
  },
) {
  try {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], {
            type: "text/plain",
          }),
          "text/markdown": new Blob([text], {
            type: "text/markdown",
          }),
        }),
      ]);
    } catch {
      // Fallback for environments that do not support text/markdown
      await navigator.clipboard.writeText(text);
    }

    if (messages) {
      toast.success(messages.success);
    }

    return true;
  } catch (error) {
    console.error("Failed to copy note content", error);

    if (messages) {
      toast.error(messages.error);
    }

    return false;
  }
}
