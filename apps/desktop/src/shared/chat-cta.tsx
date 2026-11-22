import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

import { ChatCircle } from "@anlg/ui/components/icons";
import { cn } from "@anlg/utils";

import { useShell } from "~/contexts/shell";

export function ChatCTA({
  label,
  ariaLabel,
  scope,
}: {
  label?: ReactNode;
  ariaLabel?: string;
  /** What the question covers, shown as a chip: "This note", "All notes". */
  scope?: ReactNode;
}) {
  const { t } = useLingui();
  const { chat } = useShell();
  const isChatOpen = chat.mode !== "FloatingClosed";
  const resolvedLabel = label ?? t`Ask anything`;

  const handleClick = () => {
    chat.sendEvent({ type: "OPEN" });
  };

  if (chat.mode === "RightPanelOpen") {
    return null;
  }

  return (
    <button
      type="button"
      data-chat-cta-trigger
      aria-hidden={isChatOpen}
      inert={isChatOpen}
      aria-label={ariaLabel ?? t`Ask Mirna anything`}
      onClick={handleClick}
      className={cn([
        "group/anarlog-chat-cta relative h-10 w-[min(640px,calc(100cqw_-_2rem))] max-w-full cursor-text focus-visible:outline-none",
        isChatOpen && "invisible",
      ])}
    >
      <span
        data-chat-cta-surface
        aria-hidden="true"
        className={cn([
          "border-border pointer-events-none absolute bottom-0 left-1/2 inline-flex h-10 w-[min(640px,calc(100cqw_-_2rem))] -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-xl border",
          "bg-card origin-bottom pr-1.5 pl-3.5 text-sm shadow-[0_6px_20px_rgba(47,52,49,0.07)] transition-[width,height,padding,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.32)]",
          "group-focus-visible/anarlog-chat-cta:ring-ring group-focus-visible/anarlog-chat-cta:ring-2 group-focus-visible/anarlog-chat-cta:ring-offset-2",
        ])}
      >
        <ChatCircle
          size={17}
          aria-hidden="true"
          className="text-muted-foreground shrink-0"
        />
        <span
          aria-hidden="true"
          className="text-muted-foreground min-w-0 flex-1 truncate text-left"
        >
          {resolvedLabel}
        </span>
        {scope ? (
          <span
            aria-hidden="true"
            className="bg-secondary text-foreground/80 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
          >
            {scope}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function FloatingChatCTA({
  label,
  scope,
}: {
  label?: ReactNode;
  scope?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex h-10 w-[min(640px,calc(100cqw_-_2rem))] max-w-[calc(100%-2rem)] -translate-x-1/2 items-end justify-center pb-0">
      <div className="pointer-events-auto max-w-full">
        <ChatCTA label={label} scope={scope} />
      </div>
    </div>
  );
}
