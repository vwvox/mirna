import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { commands as localSttCommands } from "@anlg/plugin-local-stt";
import { ArrowsClockwise } from "@anlg/ui/components/icons";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@anlg/ui/components/ui/dropdown-menu";

import type { TranscriptEngineChoice } from "~/session/components/note-input/transcript/actions";
import { useProcessingLocation } from "~/shared/processing-location";

export const ON_DEVICE_ENGINES = [
  "soniqo-parakeet-batch",
  "soniqo-qwen3-small",
  "soniqo-qwen3-large",
] as const;

type OnDeviceEngine = (typeof ON_DEVICE_ENGINES)[number];

async function isDownloaded(model: OnDeviceEngine): Promise<boolean> {
  try {
    const result = await localSttCommands.isModelDownloaded(model);
    return result.status === "ok" && result.data;
  } catch {
    return false;
  }
}

async function downloadedEngines(): Promise<OnDeviceEngine[]> {
  const downloaded = await Promise.all(ON_DEVICE_ENGINES.map(isDownloaded));
  return ON_DEVICE_ENGINES.filter((_, index) => downloaded[index]);
}

/**
 * "Transcribe again" in the … menu. With on-device engines downloaded, it
 * opens a submenu to pick one for this recording only; Settings stay as they
 * are.
 */
export function TranscribeAgain({
  onTranscribe,
}: {
  onTranscribe: (engine?: TranscriptEngineChoice) => void;
}) {
  const { t } = useLingui();
  const location = useProcessingLocation();
  const { data: engines = [] } = useQuery({
    queryKey: ["on-device-transcription-engines"],
    queryFn: downloadedEngines,
    staleTime: 30_000,
  });
  const describe: Record<OnDeviceEngine, { label: string; detail: string }> = {
    "soniqo-parakeet-batch": {
      label: "Parakeet",
      detail: t`Fast. 25 European languages.`,
    },
    "soniqo-qwen3-small": {
      label: "Qwen3-ASR",
      detail: t`52 languages, including Chinese.`,
    },
    "soniqo-qwen3-large": {
      label: "Qwen3-ASR Large",
      detail: t`Most accurate. Slower.`,
    },
  };

  if (engines.length === 0) {
    return (
      <DropdownMenuItem
        onClick={() => onTranscribe()}
        className="cursor-pointer"
      >
        <ArrowsClockwise />
        <span>{t`Transcribe again`}</span>
      </DropdownMenuItem>
    );
  }

  const settingsEngine = location.transcription?.label;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="cursor-pointer">
        <ArrowsClockwise />
        <span>{t`Transcribe again`}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent variant="app" className="w-64">
          <AppFloatingPanel className={appFloatingMenuPanelClassName}>
            <DropdownMenuItem
              onClick={() => onTranscribe()}
              className="cursor-pointer"
            >
              <span className="flex flex-col">
                <span>{t`With your settings`}</span>
                {settingsEngine ? (
                  <span className="text-muted-foreground text-xs">
                    {settingsEngine}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {engines.map((model) => (
              <DropdownMenuItem
                key={model}
                onClick={() => onTranscribe({ provider: "soniqo", model })}
                className="cursor-pointer"
              >
                <span className="flex flex-col">
                  <span>{describe[model].label}</span>
                  <span className="text-muted-foreground text-xs">
                    {describe[model].detail}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </AppFloatingPanel>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
