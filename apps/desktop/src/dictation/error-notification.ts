import { t } from "@lingui/core/macro";

import { commands as notificationCommands } from "@anlg/plugin-notification";

import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";
import { isAppWindowInactive } from "~/shared/window-activity";

const DICTATION_ERROR_TIMEOUT_SECONDS = 8;

/**
 * Dictation runs while another app is in front, where Mirna's own toast can't be seen. A failure
 * there is shown as a notification instead, unless the person turned notifications off.
 */
export async function showDictationErrorNotification(message: string) {
  try {
    if (!(await isAppWindowInactive())) return;
    const stored = await getStoredSettingValues();
    if (resolveConfigValue("notification_disabled", stored)) return;
    const result = await notificationCommands.showNotification({
      key: `dictation-error:${crypto.randomUUID()}`,
      title: t`Dictation didn't finish`,
      message,
      timeout: { secs: DICTATION_ERROR_TIMEOUT_SECONDS, nanos: 0 },
      source: null,
      start_time: null,
      participants: null,
      event_details: null,
      action_label: null,
      action: null,
      action_menu: null,
      action_variant: null,
      options: null,
      footer: null,
      icon: null,
    });
    if (result.status === "error")
      console.error("[dictation] failed to show notification", result.error);
  } catch (error) {
    console.error("[dictation] failed to show notification", error);
  }
}
