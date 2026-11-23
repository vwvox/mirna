import { NativeModule, requireOptionalNativeModule } from "expo";

export type DiscoveredMac = {
  name: string;
  /** IPv4 addresses, best first. */
  hosts: string[];
  port: number;
  /** The Mac's short id from its Bonjour record, if present. */
  id: string | null;
};

declare class MirnaMacDiscoveryModule extends NativeModule {
  isOnLocalNetwork(): boolean;
  currentNetworkKey(): string | null;
  discover(timeoutMs: number): Promise<DiscoveredMac[]>;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  openAppSettings(): boolean;
  canPostPromotedNotifications(): boolean;
  openPromotedNotificationSettings(): boolean;
}

function callNative<T>(run: (module: MirnaMacDiscoveryModule) => T, fallback: T): T {
  try {
    return native ? run(native) : fallback;
  } catch {
    return fallback;
  }
}

/** Whether Android lets Mirna keep running with the screen off. */
export function isIgnoringBatteryOptimizations(): boolean {
  return callNative((module) => module.isIgnoringBatteryOptimizations(), true);
}

/** Shows Android's "Let Mirna run in the background?" dialog. */
export function requestIgnoreBatteryOptimizations(): boolean {
  return callNative((module) => module.requestIgnoreBatteryOptimizations(), false);
}

/** Opens Mirna's app info (OPPO keeps "Allow background activity" there). */
export function openAppSettings(): boolean {
  return callNative((module) => module.openAppSettings(), false);
}

/** Whether Android may show the recording as a Live Update (status bar chip, lock screen). */
export function canPostPromotedNotifications(): boolean {
  return callNative((module) => module.canPostPromotedNotifications(), false);
}

/** Opens the setting that lets Mirna show Live Updates. */
export function openPromotedNotificationSettings(): boolean {
  return callNative((module) => module.openPromotedNotificationSettings(), false);
}

const native =
  requireOptionalNativeModule<MirnaMacDiscoveryModule>("MirnaMacDiscovery");

/** Wi-Fi or Ethernet, as opposed to mobile data or no network. */
export function isOnLocalNetwork(): boolean {
  try {
    return native?.isOnLocalNetwork() ?? true;
  } catch {
    return true;
  }
}

/**
 * A rough fingerprint of the current Wi-Fi (router address and subnet), or
 * null when not on Wi-Fi or Ethernet. Used to tell home from elsewhere.
 */
export function currentNetworkKey(): string | null {
  try {
    return native?.currentNetworkKey() ?? null;
  } catch {
    return null;
  }
}

/** Looks for Macs running Mirna on the local network (Bonjour). */
export async function discoverMacs(timeoutMs = 4000): Promise<DiscoveredMac[]> {
  if (!native) return [];
  try {
    return await native.discover(timeoutMs);
  } catch {
    return [];
  }
}
