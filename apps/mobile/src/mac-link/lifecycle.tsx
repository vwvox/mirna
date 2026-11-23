import { AppState } from "react-native";

import { useMountEffect } from "@/lib/use-mount-effect";

import { syncBackgroundJob } from "./background";
import { loadPairedMac } from "./pairing";
import { needsBackgroundSync, sendRecordingsToMac } from "./sender";

// While the app is open: sync when it starts or comes back to the front
// (sending what's waiting and fetching notes the Mac changed), then check
// every 30 seconds while a recording is still on its way, so "Transcribing on
// your Mac" turns into the note's summary without a tap.
export function MacLinkLifecycle() {
  useMountEffect(() => {
    let active = AppState.currentState === "active";
    const opened = async () => {
      if (!active || !(await loadPairedMac())) return;
      await sendRecordingsToMac("open");
    };
    const tick = async () => {
      if (!active || !(await loadPairedMac())) return;
      if (await needsBackgroundSync()) await sendRecordingsToMac("interval");
    };

    void syncBackgroundJob();
    void opened();
    const subscription = AppState.addEventListener("change", (state) => {
      const wasActive = active;
      active = state === "active";
      if (active && !wasActive) void opened();
    });
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  });
  return null;
}
