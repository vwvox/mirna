// Pinyin over Chinese characters in transcripts, worked out on the phone from
// the characters (pinyin-pro, the same library the Mac uses, which reads 便宜
// as pián yi from context). Pure helpers, so node's test runner can run them.

// Hermes's regex support for \p{Script=Han} varies; these ranges cover the
// CJK ideographs speech engines write.
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

export type PinyinPart = { text: string; pinyin?: string };

type PinyinItem = { origin: string; pinyin: string; isZh: boolean };
export type PinyinFunction = (
  text: string,
  options: { type: "all" },
) => PinyinItem[];

/** Characters with their pinyin; everything else passes through in runs. */
export function annotatePinyin(
  text: string,
  pinyin: PinyinFunction,
): PinyinPart[] {
  const parts: PinyinPart[] = [];
  for (const item of pinyin(text, { type: "all" })) {
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
 * Pieces that can wrap onto the next line on their own: each character with
 * its pinyin, and other text a word at a time (with its trailing space).
 */
export function wrapTokens(parts: PinyinPart[]): PinyinPart[] {
  const tokens: PinyinPart[] = [];
  for (const part of parts) {
    if (part.pinyin !== undefined) {
      tokens.push(part);
      continue;
    }
    for (const word of part.text.match(/\S+\s*|\s+/g) ?? []) {
      tokens.push({ text: word });
    }
  }
  return tokens;
}
