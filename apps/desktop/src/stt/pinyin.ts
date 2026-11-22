import { useEffect, useState } from "react";
import { create } from "zustand";

/**
 * Pinyin over Chinese characters in transcripts, generated on this Mac from
 * the characters (pinyin-pro, which reads 便宜 as pián yi and 出差 as chū chāi
 * from context). Speech engines' own romanisation is unreliable, so Mirna
 * never asks them for it.
 */

const STORAGE_KEY = "mirna:transcript-pinyin";
const HAN = /\p{Script=Han}/u;

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const usePinyinPreference = create<{
  show: boolean;
  setShow: (show: boolean) => void;
}>((set) => ({
  show: readStored(),
  setShow: (show) => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, show ? "1" : "0");
    } catch {
      // Private windows can refuse storage; the toggle still works this session.
    }
    set({ show });
  },
}));

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

export type PinyinPart = { text: string; pinyin?: string };

type PinyinModule = typeof import("pinyin-pro");
let pinyinModule: PinyinModule | null = null;
let loading: Promise<PinyinModule> | null = null;

function loadPinyin(): Promise<PinyinModule> {
  loading ??= import("pinyin-pro").then((module) => {
    pinyinModule = module;
    return module;
  });
  return loading;
}

/** Characters with their pinyin; everything else passes through in runs. */
export function annotatePinyin(
  text: string,
  module: Pick<PinyinModule, "pinyin">,
): PinyinPart[] {
  const parts: PinyinPart[] = [];
  for (const item of module.pinyin(text, { type: "all" })) {
    if (item.isZh && item.pinyin) {
      parts.push({ text: item.origin, pinyin: item.pinyin });
      continue;
    }
    const last = parts[parts.length - 1];
    if (last && last.pinyin === undefined) last.text += item.origin;
    else parts.push({ text: item.origin });
  }
  return parts;
}

/**
 * The pinyin module once pinyin is switched on; it's loaded only then, so
 * notes without Chinese don't pay for its dictionary.
 */
export function usePinyinModule(enabled: boolean): PinyinModule | null {
  const [module, setModule] = useState(pinyinModule);
  useEffect(() => {
    if (!enabled || module) return;
    let cancelled = false;
    void loadPinyin().then((loaded) => {
      if (!cancelled) setModule(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, module]);
  return enabled ? module : null;
}
