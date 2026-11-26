import { Trans } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import { Button } from "@anlg/ui/components/ui/button";

import { DefaultMeetingShareAccessSelector } from "./default-share-access";
import { PrimaryRecordingDeviceSelector } from "./primary-recording-device";

import { useBillingAccess } from "~/auth/billing-context";
import { PlanGate } from "~/settings/plan-gate";
import { SettingRow, SettingSwitchRow } from "~/settings/setting-row";
import { reviewRecordingConsent } from "~/stt/recording-consent";

interface SettingItem {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function MeetingSettingsView({
  autoJoinScheduledMeetings,
  autoStartScheduledMeetings,
  autoStopMeetings,
  floatingBar,
  meetingDisclosureAutoPost,
  captureMeetingChat,
  captureSharedScreens,
}: {
  autoJoinScheduledMeetings: SettingItem;
  autoStartScheduledMeetings: SettingItem;
  autoStopMeetings: SettingItem;
  floatingBar: SettingItem;
  meetingDisclosureAutoPost: SettingItem;
  captureMeetingChat: SettingItem;
  captureSharedScreens: SettingItem;
}) {
  const { isPro } = useBillingAccess();
  const currentPlatform = platform();
  const supportsMeetingAx =
    currentPlatform === "macos" || currentPlatform === "linux";
  const supportsMicDetection = currentPlatform !== "windows";
  const supportsScreenCapture =
    currentPlatform === "macos" || currentPlatform === "windows";

  return (
    <div className="flex flex-col gap-4">
      <DefaultMeetingShareAccessSelector />
      <PrimaryRecordingDeviceSelector />
      <SettingRow
        title={<Trans>Recording consent</Trans>}
        description={
          <Trans>
            The reminder about consent Mirna shows before your first recording.
          </Trans>
        }
        controlWidth="content"
      >
        {(labelProps) => (
          <Button
            variant="outline"
            size="sm"
            onClick={reviewRecordingConsent}
            {...labelProps}
          >
            <Trans>Read again</Trans>
          </Button>
        )}
      </SettingRow>
      <PlanGate plan="pro" allowed={isPro} className="flex flex-col gap-4">
        <SettingSwitchRow
          title={<Trans>Start when meeting begins</Trans>}
          description={
            <Trans>Start listening when a scheduled meeting begins.</Trans>
          }
          checked={isPro && autoStartScheduledMeetings.value}
          onChange={autoStartScheduledMeetings.onChange}
        />
        <SettingSwitchRow
          title={<Trans>Join scheduled meetings</Trans>}
          description={
            <Trans>
              Open the meeting link when a scheduled meeting begins.
            </Trans>
          }
          checked={isPro && autoJoinScheduledMeetings.value}
          onChange={autoJoinScheduledMeetings.onChange}
          disabled={!autoStartScheduledMeetings.value}
        />
      </PlanGate>
      {supportsMicDetection && (
        <SettingSwitchRow
          title={<Trans>Stop when meeting ends</Trans>}
          description={<Trans>Stop listening when your call ends.</Trans>}
          checked={autoStopMeetings.value}
          onChange={autoStopMeetings.onChange}
        />
      )}
      {supportsMeetingAx && (
        <>
          <SettingSwitchRow
            title={<Trans>Post recording disclosure in meeting chat</Trans>}
            description={
              <Trans>
                Tell participants when listening starts; this does not confirm
                consent.
              </Trans>
            }
            checked={meetingDisclosureAutoPost.value}
            onChange={meetingDisclosureAutoPost.onChange}
          />
          <SettingSwitchRow
            title={<Trans>Capture meeting chat in Memos</Trans>}
            description={
              <Trans>
                Save visible chat from supported meetings using Accessibility.
              </Trans>
            }
            checked={captureMeetingChat.value}
            onChange={captureMeetingChat.onChange}
          />
        </>
      )}
      {supportsScreenCapture && (
        <SettingSwitchRow
          title={<Trans>Capture shared screens in Memos</Trans>}
          description={
            <Trans>
              Save slides and screens others share in meetings. Requires Screen
              Recording.
            </Trans>
          }
          checked={captureSharedScreens.value}
          onChange={captureSharedScreens.onChange}
        />
      )}
      <SettingSwitchRow
        title={<Trans>Show floating bar</Trans>}
        description={<Trans>Control listening without reopening Mirna.</Trans>}
        checked={floatingBar.value}
        onChange={floatingBar.onChange}
      />
    </div>
  );
}
