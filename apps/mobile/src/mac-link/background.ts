// Android background job (WorkManager, at most every 15 minutes) that sends
// waiting recordings and fetches finished notes while the app is closed.
// `defineTask` must run when the JS bundle loads, so the root layout imports
// this module.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { hasPendingRecordings, sendRecordingsToMac } from "./sender";

export const MAC_LINK_TASK = "mirna-send-to-mac";

TaskManager.defineTask(MAC_LINK_TASK, async () => {
  try {
    if (await hasPendingRecordings()) {
      await sendRecordingsToMac();
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn("[mac-link] background send failed", error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerMacLinkBackgroundTask() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(MAC_LINK_TASK)) return;
    await BackgroundTask.registerTaskAsync(MAC_LINK_TASK, {
      minimumInterval: 15,
    });
  } catch (error) {
    console.warn("[mac-link] could not schedule background sending", error);
  }
}
