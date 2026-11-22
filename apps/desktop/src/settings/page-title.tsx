import type { ReactNode } from "react";

export function SettingsPageTitle({ title }: { title: ReactNode }) {
  return (
    <h2 className="font-brand text-mirna-wordmark text-3xl leading-tight font-normal tracking-[-0.01em]">
      {title}
    </h2>
  );
}
