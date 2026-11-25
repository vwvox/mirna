// The "Show pinyin" switch on transcripts with Chinese, remembered on this
// phone, and the pinyin library, loaded the first time it's switched on.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import type { PinyinFunction } from "./pinyin-model";

const STORAGE_KEY = "mirna.transcript.pinyin";

let show = false;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function load() {
  if (loaded) return;
  loaded = true;
  void AsyncStorage.getItem(STORAGE_KEY)
    .then((value) => {
      show = value === "1";
      notify();
    })
    .catch(() => {});
}

export function usePinyinPreference(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      load();
      return () => listeners.delete(listener);
    },
    () => show,
  );
  return [
    value,
    (next) => {
      show = next;
      notify();
      void AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0").catch(() => {});
    },
  ];
}

let pinyinFunction: PinyinFunction | null = null;

/** pinyin-pro's dictionary is large, so it loads only when pinyin is on. */
export function loadPinyin(): PinyinFunction {
  pinyinFunction ??= (require("pinyin-pro") as typeof import("pinyin-pro"))
    .pinyin as unknown as PinyinFunction;
  return pinyinFunction;
}
