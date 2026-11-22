// Which Mac this phone is paired with, and the phone's own identity.
//
// The identity's private key stays in the Android keystore-backed secure
// store. The Mac's details (name, addresses, certificate fingerprint) aren't
// secret and live in AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import * as bridge from "./bridge";
import type { MacTarget, PhoneIdentity } from "./bridge";

const IDENTITY_KEY = "mirna.mac_link.identity";
const MAC_KEY = "mirna.mac_link.mac";

export type PairedMac = {
  mac_id: string;
  mac_name: string;
  fingerprint: string;
  addresses: string[];
  port: number;
  last_host: string | null;
  paired_at: string;
};

let current: PairedMac | null | undefined;
const listeners = new Set<() => void>();

function publish(next: PairedMac | null) {
  current = next;
  for (const listener of listeners) listener();
}

export async function loadPairedMac(): Promise<PairedMac | null> {
  if (current !== undefined) return current;
  try {
    const stored = await AsyncStorage.getItem(MAC_KEY);
    current = stored ? (JSON.parse(stored) as PairedMac) : null;
  } catch {
    current = null;
  }
  for (const listener of listeners) listener();
  return current;
}

async function savePairedMac(mac: PairedMac | null) {
  if (mac) await AsyncStorage.setItem(MAC_KEY, JSON.stringify(mac));
  else await AsyncStorage.removeItem(MAC_KEY);
  publish(mac);
}

export function usePairedMac(): { mac: PairedMac | null; loading: boolean } {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (current === undefined) void loadPairedMac();
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return { mac: value ?? null, loading: value === undefined };
}

export async function loadIdentity(): Promise<PhoneIdentity | null> {
  const stored = await SecureStore.getItemAsync(IDENTITY_KEY);
  return stored ? (JSON.parse(stored) as PhoneIdentity) : null;
}

async function ensureIdentity(): Promise<PhoneIdentity> {
  const existing = await loadIdentity();
  if (existing) return existing;
  const identity = await bridge.newIdentity();
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

export function phoneName(): string {
  return (
    Device.deviceName?.trim() ||
    [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").trim() ||
    "Android phone"
  );
}

/** Pairs with the Mac whose QR code was scanned. */
export async function pairWithScannedCode(text: string): Promise<PairedMac> {
  const offer = await bridge.parseOffer(text);
  const identity = await ensureIdentity();
  const reply = await bridge.pair({ identity, offer, phoneName: phoneName() });
  const mac: PairedMac = {
    mac_id: reply.mac_id,
    mac_name: reply.mac_name || offer.mac_name,
    fingerprint: offer.fingerprint,
    addresses: offer.addresses,
    port: offer.port,
    last_host: reply.working_host,
    paired_at: new Date().toISOString(),
  };
  await savePairedMac(mac);
  return mac;
}

export async function unpairMac(): Promise<void> {
  await savePairedMac(null);
}

/** Remembers where the Mac answered, so it's tried first next time. */
export async function rememberWorkingHost(
  host: string | null,
  port?: number,
  name?: string,
) {
  const mac = await loadPairedMac();
  if (!mac) return;
  const changed =
    (host && host !== mac.last_host) ||
    (port && port !== mac.port) ||
    (name && name !== mac.mac_name);
  if (!changed) return;
  await savePairedMac({
    ...mac,
    last_host: host ?? mac.last_host,
    port: port ?? mac.port,
    mac_name: name ?? mac.mac_name,
  });
}

export function targetFor(
  mac: PairedMac,
  discovered: { hosts: string[]; port: number } | null,
): MacTarget {
  const hosts = [
    ...(mac.last_host ? [mac.last_host] : []),
    ...(discovered?.hosts ?? []),
    ...mac.addresses,
  ].filter((host, index, all) => all.indexOf(host) === index);
  return {
    hosts,
    port: discovered?.port ?? mac.port,
    fingerprint: mac.fingerprint,
  };
}
