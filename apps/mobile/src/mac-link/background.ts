// Android background job (WorkManager, at most every 15 minutes) that sends
// waiting recordings and follows the ones the Mac is working on while the app
// is closed. It is only scheduled while something still needs the Mac, and
// cancelled as soon as nothing does, so an idle phone isn't woken for Mirna.
// `defineTask` must run when the JS bundle loads, so the root layout imports
// this module.
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { needsBackgroundSync, onSendFinished, sendRecordingsToMac } from "./sender";

export const MAC_LINK_TASK = "mirna-send-to-mac";

TaskManager.defineTask(MAC_LINK_TASK, async () => {
  try {
    await sendRecordingsToMac("background");
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn("[mac-link] background send failed", error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let syncing: Promise<void> | null = null;

/** Schedules the background job while something needs the Mac, cancels it otherwise. */
export function syncBackgroundJob(): Promise<void> {
  syncing ??= updateBackgroundJob().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function updateBackgroundJob() {
  try {
    const wanted = await needsBackgroundSync();
    const registered = await TaskManager.isTaskRegisteredAsync(MAC_LINK_TASK);
    if (wanted && !registered) {
      const status = await BackgroundTask.getStatusAsync();
      if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
      await BackgroundTask.registerTaskAsync(MAC_LINK_TASK, {
        minimumInterval: 15,
      });
    } else if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(MAC_LINK_TASK);
    }
  } catch (error) {
    console.warn("[mac-link] could not update background sending", error);
  }
}

// Every sync can change what's waiting.
onSendFinished(() => void syncBackgroundJob());
