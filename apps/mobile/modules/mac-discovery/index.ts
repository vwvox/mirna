import { NativeModule, requireOptionalNativeModule } from "expo";

export type DiscoveredMac = {
  name: string;
  /** IPv4 addresses, best first. */
  hosts: string[];
  port: number;
  /** The Mac's short id from its Bonjour record, if present. */
  id: string | null;
};

/** A subnet this phone serves as a hotspot (Wi-Fi, USB or Bluetooth). */
export type HotspotSubnet = {
  interface: string;
  /** The phone's own IPv4 address on it. */
  address: string;
  prefix_length: number;
};

/** currentNetworkKey() while the phone is the hotspot, rather than on Wi-Fi. */
export const PHONE_HOTSPOT_NETWORK = "phone-hotspot";

declare class MirnaMacDiscoveryModule extends NativeModule {
  isOnLocalNetwork(): boolean;
  currentNetworkKey(): string | null;
  hotspotSubnets(): HotspotSubnet[];
  probe(hosts: string[], port: number, timeoutMs: number): Promise<string[]>;
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

/**
 * On Wi-Fi or Ethernet, or serving a hotspot the Mac could be on; as opposed
 * to mobile data alone or no network.
 */
export function isOnLocalNetwork(): boolean {
  try {
    return native?.isOnLocalNetwork() ?? true;
  } catch {
    return true;
  }
}

/**
 * A rough fingerprint of the current Wi-Fi (router address and subnet),
 * PHONE_HOTSPOT_NETWORK while the phone is the hotspot, or null when neither.
 * Used to tell home from elsewhere.
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

/** Subnets this phone serves as a hotspot; empty when it isn't one. */
export function hotspotSubnets(): HotspotSubnet[] {
  return callNative((module) => module.hotspotSubnets(), []);
}

/** Which of these addresses accept a connection on the port (all tried at once). */
export async function probePort(
  hosts: string[],
  port: number,
  timeoutMs = 1500,
): Promise<string[]> {
  if (!native || hosts.length === 0) return [];
  try {
    return await native.probe(hosts, port, timeoutMs);
  } catch {
    return [];
  }
}
