import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { useMountEffect } from "@/lib/use-mount-effect";

import {
  canPostPromotedNotifications,
  openPromotedNotificationSettings,
} from "../../modules/mac-discovery";

// Android 16 shows a recording's notification as a Live Update (a timer chip
// in the status bar and a card on the lock screen) only if the user allows it.
const LIVE_UPDATES_API_LEVEL = 36;
const DISMISSED_KEY = "mirna:live-updates-prompt-dismissed";

// null until AsyncStorage answers, so the prompt never flashes up.
let dismissed: boolean | null = null;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function publish(value: boolean) {
  dismissed = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadDismissed();
  return () => {
    listeners.delete(listener);
  };
}

function getDismissed() {
  return dismissed;
}

function loadDismissed(): Promise<void> {
  loading ??= AsyncStorage.getItem(DISMISSED_KEY).then(
    (value) => publish(value === "1"),
    () => publish(false),
  );
  return loading;
}

function liveUpdatesSupported(): boolean {
  return (
    Platform.OS === "android" &&
    Number(Platform.Version) >= LIVE_UPDATES_API_LEVEL
  );
}

/**
 * Whether to offer Live Updates on the recording screen, and its two answers.
 * "Not now" is remembered on this phone. After "Turn on" the answer is read
 * again when Mirna comes back from Settings.
 */
export function useLiveUpdatesPrompt(): {
  visible: boolean;
  turnOn: () => void;
  notNow: () => void;
} {
  const supported = liveUpdatesSupported();
  const isDismissed = useSyncExternalStore(
    subscribe,
    getDismissed,
    getDismissed,
  );
  const [allowed, setAllowed] = useState(
    () => !supported || canPostPromotedNotifications(),
  );

  useMountEffect(() => {
    if (!supported) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setAllowed(canPostPromotedNotifications());
    });
    return () => subscription.remove();
  });

  return {
    visible: supported && !allowed && isDismissed === false,
    turnOn: () => {
      openPromotedNotificationSettings();
    },
    notNow: () => {
      publish(true);
      void AsyncStorage.setItem(DISMISSED_KEY, "1").catch(() => {
        // Asked again next time; nothing else depends on it.
      });
    },
  };
}
