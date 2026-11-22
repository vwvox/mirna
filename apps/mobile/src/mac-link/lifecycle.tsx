import { AppState } from "react-native";

import { useMountEffect } from "@/lib/use-mount-effect";

import { registerMacLinkBackgroundTask } from "./background";
import { loadPairedMac } from "./pairing";
import { hasPendingRecordings, sendRecordingsToMac } from "./sender";

// While the app is open: send when it starts or comes back to the front, and
// keep checking every 30 seconds while anything is still on its way, so
// "Transcribing on your Mac" turns into the note's summary without a tap.
export function MacLinkLifecycle() {
  useMountEffect(() => {
    let active = AppState.currentState === "active";
    const tick = async () => {
      if (!active) return;
      if (!(await loadPairedMac())) return;
      if (await hasPendingRecordings()) await sendRecordingsToMac();
    };

    void registerMacLinkBackgroundTask();
    void tick();
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      if (active) void tick();
    });
    const timer = setInterval(() => void tick(), 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  });
  return null;
}
