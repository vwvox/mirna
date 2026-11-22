import { cn } from "@anlg/utils";

import { MirnaMist } from "./mirna-wordmark";

export function BrandLoadingView({ detail }: { detail?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-tauri-drag-region
      className={cn([
        "bg-background flex h-screen w-screen items-center justify-center",
      ])}
    >
      <div className="flex flex-col items-center">
        <div className={cn(["relative w-24"])}>
          <MirnaMist className="h-auto w-full opacity-30" strokeWidth="3px" />
          <div
            aria-hidden="true"
            className={cn([
              "pointer-events-none absolute inset-0",
              "[-webkit-mask-image:linear-gradient(105deg,transparent_36%,#000_50%,transparent_64%)]",
              "[mask-image:linear-gradient(105deg,transparent_36%,#000_50%,transparent_64%)]",
              "[-webkit-mask-size:220%_100%]",
              "[mask-size:220%_100%]",
              "animate-logo-shimmer-sweep",
              "motion-reduce:animate-none motion-reduce:opacity-0",
            ])}
          >
            <MirnaMist className="h-auto w-full" strokeWidth="3px" />
          </div>
        </div>
        {detail ? (
          <p className="text-muted-foreground mt-5 max-w-64 text-center text-xs">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
