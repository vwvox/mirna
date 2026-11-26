import { Trans } from "@lingui/react/macro";
import {
  type ComponentType,
  type ReactNode,
  useSyncExternalStore,
} from "react";

import { commands as windowsCommands } from "@anlg/plugin-windows";
import {
  ChatCircle,
  Laptop,
  MapPin,
  Microphone,
  UserFocus,
} from "@anlg/ui/components/icons";
import { Button } from "@anlg/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@anlg/ui/components/ui/dialog";

import { getStoredSettingValues, setSettingValue } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";
import {
  GlassDialogCancelButton,
  GlassDialogContent,
} from "~/shared/ui/glass-dialog";

// Recording laws differ by place and Mirna can't know where anyone is, so
// before the first recording it asks the user to check the rules and tell
// people. Nothing starts until they agree.
type ConsentScreen = { mode: "before_recording" } | { mode: "review" };

let screen: ConsentScreen | null = null;
// Shared by every start that arrives while the question is open, and kept
// until the answer is saved, so a late start never opens a second screen.
let pendingAnswer: Promise<boolean> | null = null;
let settle: ((agreed: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function show(next: ConsentScreen | null) {
  screen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function confirmRecordingConsent(): Promise<boolean> {
  if (pendingAnswer) return pendingAnswer;
  const stored = await getStoredSettingValues();
  if (resolveConfigValue("recording_consent_acknowledged", stored) === true) {
    return true;
  }
  if (pendingAnswer) return pendingAnswer;

  const answer = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  pendingAnswer = answer;
  show({ mode: "before_recording" });
  // Starts from the floating bar, tray or an automatic meeting start can come
  // while the main window is hidden; the question has to be seen to be answered.
  try {
    await windowsCommands.windowShow({ type: "main" });
  } catch (error) {
    console.error("[consent] failed to show the main window", error);
  }
  return answer;
}

export function reviewRecordingConsent() {
  if (screen) return;
  show({ mode: "review" });
}

async function close(agreed: boolean) {
  const resolve = settle;
  settle = null;
  show(null);
  if (agreed) {
    await setSettingValue("recording_consent_acknowledged", true).catch(
      (error) => {
        console.error("[consent] failed to save acknowledgement", error);
      },
    );
  }
  pendingAnswer = null;
  resolve?.(agreed);
}

export function RecordingConsentDialog() {
  const current = useSyncExternalStore(subscribe, () => screen);
  const beforeRecording = current?.mode === "before_recording";

  return (
    <Dialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) void close(false);
      }}
    >
      <GlassDialogContent
        data-recording-consent
        className="max-w-[440px] gap-5 p-6"
      >
        <div className="bg-mirna-moss text-mirna-serra dark:bg-mirna-serra dark:text-mirna-moss flex size-10 items-center justify-center rounded-full">
          <Microphone className="size-5" aria-hidden />
        </div>
        <DialogHeader className="gap-2 text-left sm:text-left">
          <DialogTitle className="font-brand text-mirna-wordmark text-2xl leading-tight font-normal">
            <Trans>Before you record</Trans>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            <Trans>
              Recording laws differ from place to place. Some places need only
              your consent; others need everyone in the conversation to agree.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3.5">
          <ConsentPoint icon={MapPin}>
            <Trans>
              Check the rules where you and the people you record are. Mirna
              can't know where everyone is, so it can't decide this for you.
            </Trans>
          </ConsentPoint>
          <ConsentPoint icon={ChatCircle}>
            <Trans>
              Tell people before you start, and stop if anyone would rather you
              didn't.
            </Trans>
          </ConsentPoint>
          <ConsentPoint icon={UserFocus}>
            <Trans>
              Voice recognition is off. Mirna asks before remembering anyone's
              voice.
            </Trans>
          </ConsentPoint>
          <ConsentPoint icon={Laptop}>
            <Trans>
              Recordings and notes stay on this device unless you turn on cloud
              transcription or cloud AI.
            </Trans>
          </ConsentPoint>
        </ul>
        <p className="text-muted-foreground text-xs leading-relaxed">
          <Trans>
            This isn't legal advice. You can read it again in Settings, under
            Meetings.
          </Trans>
        </p>
        <DialogFooter className="gap-2">
          {beforeRecording ? (
            <>
              <GlassDialogCancelButton onClick={() => void close(false)}>
                <Trans>Cancel</Trans>
              </GlassDialogCancelButton>
              <Button onClick={() => void close(true)}>
                <Trans>I understand, start recording</Trans>
              </Button>
            </>
          ) : (
            <Button onClick={() => void close(false)}>
              <Trans>Close</Trans>
            </Button>
          )}
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  );
}

function ConsentPoint({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 text-sm leading-relaxed">
      <Icon
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden
      />
      <span>{children}</span>
    </li>
  );
}
