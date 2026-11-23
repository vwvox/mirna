// What the phone remembers about syncing with the Mac: whether to send by
// itself, where the Mac has answered before, how long to wait after it didn't,
// and how far it has read the Mac's note changes. None of it is secret.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import {
  type Backoff,
  backoffAfterFailure,
  rememberNetwork,
  type SendMode,
} from "./model";

const SEND_MODE_KEY = "mirna.mac_link.send_mode";
const BACKOFF_KEY = "mirna.mac_link.backoff";
const NETWORKS_KEY = "mirna.mac_link.networks";
const NOTES_CURSOR_KEY = "mirna.mac_link.notes_cursor";
const MAC_NOTES_KEY = "mirna.mac_link.include_mac_notes";
const LAST_SYNC_KEY = "mirna.mac_link.last_sync";

/** Tiny observable value kept in AsyncStorage, for settings the UI shows. */
function storedValue<T>(key: string, fallback: T) {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const load = async (): Promise<T> => {
    if (value === undefined) {
      value = (await readJson<T>(key)) ?? fallback;
      notify();
    }
    return value;
  };
  const set = async (next: T) => {
    value = next;
    notify();
    await writeJson(key, next);
  };
  const use = (): T => {
    const current = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        if (value === undefined) void load();
        return () => listeners.delete(listener);
      },
      () => value,
    );
    return current ?? fallback;
  };
  return { load, set, use };
}

// --- Notes made on the Mac --------------------------------------------------

const macNotes = storedValue<boolean>(MAC_NOTES_KEY, false);

/** Also download the text of notes recorded on the Mac (never their audio). */
export const loadIncludeMacNotes = macNotes.load;
export const setIncludeMacNotes = macNotes.set;
export const useIncludeMacNotes = macNotes.use;

// --- The last time the phone and Mac synced --------------------------------

export type LastSync = {
  /** ISO time of the last successful sync. */
  at: string;
  /** Notes whose text came back changed in that sync. */
  notes_updated: number;
  /** Notes the phone couldn't take in, and why (they're tried again next time). */
  notes_failed?: number;
  error?: string | null;
};

const lastSync = storedValue<LastSync | null>(LAST_SYNC_KEY, null);

export const loadLastSync = lastSync.load;
export const recordLastSync = lastSync.set;
export const useLastSync = lastSync.use;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[mac-link] could not save", key, error);
  }
}

// --- Send automatically, or only when asked ---------------------------------

let sendMode: SendMode | undefined;
const sendModeListeners = new Set<() => void>();

export async function loadSendMode(): Promise<SendMode> {
  if (sendMode === undefined) {
    sendMode = (await readJson<SendMode>(SEND_MODE_KEY)) ?? "auto";
    for (const listener of sendModeListeners) listener();
  }
  return sendMode;
}

export async function setSendMode(mode: SendMode) {
  sendMode = mode;
  for (const listener of sendModeListeners) listener();
  await writeJson(SEND_MODE_KEY, mode);
}

export function useSendMode(): SendMode {
  const value = useSyncExternalStore(
    (listener) => {
      sendModeListeners.add(listener);
      if (sendMode === undefined) void loadSendMode();
      return () => sendModeListeners.delete(listener);
    },
    () => sendMode,
  );
  return value ?? "auto";
}

// --- Waiting after the Mac didn't answer ------------------------------------

export function loadBackoff() {
  return readJson<Backoff>(BACKOFF_KEY);
}

export async function noteMacUnreachable(network: string | null) {
  await writeJson(
    BACKOFF_KEY,
    backoffAfterFailure(await loadBackoff(), network, Date.now()),
  );
}

export function clearBackoff() {
  return writeJson(BACKOFF_KEY, null);
}

// --- Wi-Fi networks where the Mac answered ----------------------------------

export async function loadKnownNetworks(): Promise<string[]> {
  return (await readJson<string[]>(NETWORKS_KEY)) ?? [];
}

export async function rememberMacNetwork(network: string | null) {
  if (!network) return;
  const known = await loadKnownNetworks();
  if (known[0] === network) return;
  await writeJson(NETWORKS_KEY, rememberNetwork(known, network));
}

// --- How far the phone has read the Mac's note changes ----------------------

type NotesCursor = {
  mac_id: string;
  cursor: number;
  include_mac_notes?: boolean;
};

/**
 * Where to resume reading the Mac's note changes. Starts over when the Mac
 * changes, or when "Notes made on the Mac" was switched on since.
 */
export async function loadNotesCursor(
  macId: string,
  includeMacNotes: boolean,
): Promise<number> {
  const stored = await readJson<NotesCursor>(NOTES_CURSOR_KEY);
  if (stored?.mac_id !== macId) return 0;
  if (includeMacNotes && !stored.include_mac_notes) return 0;
  return stored.cursor;
}

export function saveNotesCursor(
  macId: string,
  cursor: number,
  includeMacNotes: boolean,
) {
  return writeJson(NOTES_CURSOR_KEY, {
    mac_id: macId,
    cursor,
    include_mac_notes: includeMacNotes,
  } satisfies NotesCursor);
}

/** Forget everything tied to the old Mac (after pairing or unpairing). */
export async function resetMacSchedule() {
  await Promise.all([
    writeJson(BACKOFF_KEY, null),
    writeJson(NETWORKS_KEY, null),
    writeJson(NOTES_CURSOR_KEY, null),
  ]);
}
