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
  discover(timeoutMs: number): Promise<DiscoveredMac[]>;
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

/** Looks for Macs running Mirna on the local network (Bonjour). */
export async function discoverMacs(timeoutMs = 4000): Promise<DiscoveredMac[]> {
  if (!native) return [];
  try {
    return await native.discover(timeoutMs);
  } catch {
    return [];
  }
}
