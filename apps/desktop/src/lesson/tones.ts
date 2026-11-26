import { t } from "@lingui/core/macro";

import type { PinyinTools } from "~/stt/pinyin";

export type Tone = 0 | 1 | 2 | 3 | 4;

export type ToneSyllable = {
  character: string;
  pinyin: string;
  /** The tone as written. */
  tone: Tone;
  /** The tone as said: 3 before 3 becomes 2, and a third tone before others only falls. */
  spoken: Tone | "half-3";
};

const TONE_MARKS: Record<string, number> = {
  ā: 1,
  á: 2,
  ǎ: 3,
  à: 4,
  ē: 1,
  é: 2,
  ě: 3,
  è: 4,
  ī: 1,
  í: 2,
  ǐ: 3,
  ì: 4,
  ō: 1,
  ó: 2,
  ǒ: 3,
  ò: 4,
  ū: 1,
  ú: 2,
  ǔ: 3,
  ù: 4,
  ǖ: 1,
  ǘ: 2,
  ǚ: 3,
  ǜ: 4,
};

function toneless(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Splits a written reading ("jiǎozi") along the word's syllables ("jiao",
 * "zi") and reads each one's tone from its mark; null when they don't line up,
 * such as for a different reading.
 */
export function tonesFromReading(
  reading: string,
  syllables: string[],
): Array<{ pinyin: string; tone: number }> | null {
  // NFC pinyin letters are single code points, ü with its tone mark included.
  const chars = Array.from(reading.normalize("NFC").replace(/[\s'’-]/g, ""));
  const bases = chars.map((char) => toneless(char));
  const tones = chars.map((char) => TONE_MARKS[char.toLowerCase()] ?? 0);
  const result: Array<{ pinyin: string; tone: number }> = [];
  let at = 0;
  for (const syllable of syllables) {
    const plain = toneless(syllable);
    if (bases.slice(at, at + plain.length).join("") !== plain) return null;
    result.push({
      pinyin: chars.slice(at, at + plain.length).join(""),
      tone: tones.slice(at, at + plain.length).find((tone) => tone > 0) ?? 0,
    });
    at += plain.length;
  }
  return at === chars.length ? result : null;
}

export type ReadPart = { text: string; pinyin: string; tone: number | null };

/**
 * A word's characters with pinyin and tone. Pinyin-pro reads some common words
 * wrong (饺子 as jiǎo zǐ), so the study sheet's reading wins when it lines up,
 * and a word-final 子 is otherwise read light.
 */
export function readTerm(
  term: string,
  tools: Pick<PinyinTools, "pinyin">,
  reading?: string,
): ReadPart[] {
  const items = tools.pinyin(term, { type: "all" }) as unknown as Array<{
    origin: string;
    pinyin: string;
    num: number;
    isZh: boolean;
  }>;
  const parts: ReadPart[] = items.map((item) => ({
    text: item.origin,
    pinyin: item.isZh ? item.pinyin : "",
    tone: item.isZh ? item.num : null,
  }));
  const zh = parts.filter((part) => part.tone !== null);
  const fromReading = reading
    ? tonesFromReading(
        reading,
        zh.map((part) => part.pinyin),
      )
    : null;
  if (fromReading) {
    zh.forEach((part, index) => {
      part.pinyin = fromReading[index]!.pinyin;
      part.tone = fromReading[index]!.tone;
    });
    return parts;
  }
  parts.forEach((part, index) => {
    const before = parts[index - 1];
    if (part.text === "子" && before?.tone != null && part.tone === 3) {
      part.pinyin = "zi";
      part.tone = 0;
    }
  });
  return parts;
}

/** The syllables of a Chinese word with the tones a speaker actually uses. */
export function toneSyllables(
  term: string,
  tools: Pick<PinyinTools, "pinyin">,
  reading?: string,
): ToneSyllable[] {
  const syllables = readTerm(term, tools, reading)
    .filter((part) => part.tone !== null)
    .map((part) => ({
      character: part.text,
      pinyin: part.pinyin,
      tone: (part.tone! >= 0 && part.tone! <= 4 ? part.tone : 0) as Tone,
    }));
  return syllables.map((syllable, index) => {
    const next = syllables[index + 1];
    let spoken: ToneSyllable["spoken"] = syllable.tone;
    if (syllable.tone === 3 && next?.tone === 3) spoken = 2;
    else if (syllable.tone === 3 && next) spoken = "half-3";
    return { ...syllable, spoken };
  });
}

/**
 * The textbook pitch shape of each tone, in semitones around the speaker's middle
 * voice, as [time 0–1, pitch] points.
 */
export const TONE_SHAPES: Record<
  ToneSyllable["spoken"],
  Array<[number, number]>
> = {
  1: [
    [0, 3],
    [1, 3],
  ],
  2: [
    [0, -1],
    [1, 3.5],
  ],
  3: [
    [0, -1.5],
    [0.5, -5],
    [1, -1],
  ],
  "half-3": [
    [0, -2],
    [1, -5],
  ],
  4: [
    [0, 4],
    [1, -4],
  ],
  0: [
    [0, -1],
    [1, -2],
  ],
};

export type SyllableShape = "level" | "rising" | "falling" | "dipping";

/** How a syllable's pitch moved: level, rising, falling or dipping. */
export function describeShape(values: number[]): SyllableShape | null {
  if (values.length < 3) return null;
  const third = Math.max(1, Math.floor(values.length / 3));
  const mean = (part: number[]) =>
    part.reduce((sum, value) => sum + value, 0) / part.length;
  const start = mean(values.slice(0, third));
  const end = mean(values.slice(-third));
  const middle = Math.min(...values.slice(third, values.length - third));
  if (
    values.length >= 5 &&
    middle < Math.min(start, end) - 1.2 &&
    end - middle > 1
  ) {
    return "dipping";
  }
  if (end - start >= 1.5) return "rising";
  if (end - start <= -1.5) return "falling";
  return "level";
}

const EXPECTED: Record<ToneSyllable["spoken"], SyllableShape[]> = {
  1: ["level"],
  2: ["rising", "dipping"],
  3: ["dipping", "falling"],
  "half-3": ["falling", "dipping"],
  4: ["falling"],
  0: ["level", "falling", "rising", "dipping"],
};

export type SyllableResult = {
  syllable: ToneSyllable;
  heard: SyllableShape | null;
  ok: boolean;
};

/**
 * Splits a recording into the word's syllables (by its pauses when they match,
 * else evenly) and checks each syllable's shape against its tone. Third tones
 * also count when low, since they're often said without the rise.
 */
export function checkTones(
  syllables: ToneSyllable[],
  contour: Array<number | null>,
): SyllableResult[] {
  const parts = splitIntoSyllables(contour, syllables.length);
  return syllables.map((syllable, index) => {
    const values = (parts[index] ?? []).filter(
      (value): value is number => value !== null,
    );
    const heard = describeShape(values);
    const average =
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    // A third tone often comes out low and flat; that counts when it sits
    // below the rest of the word.
    const lowThird =
      (syllable.spoken === 3 || syllable.spoken === "half-3") &&
      (average < -1 || (heard === "level" && average < -0.5));
    const ok =
      heard !== null && (EXPECTED[syllable.spoken].includes(heard) || lowThird);
    return { syllable, heard, ok };
  });
}

export function splitIntoSyllables(
  contour: Array<number | null>,
  count: number,
): Array<Array<number | null>> {
  if (count <= 0) return [];
  const runs: Array<Array<number | null>> = [];
  let run: Array<number | null> = [];
  for (const value of contour) {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(value);
    }
  }
  if (run.length > 0) runs.push(run);
  if (runs.length === count) return runs;

  const size = contour.length / count;
  return Array.from({ length: count }, (_, index) =>
    contour.slice(Math.round(index * size), Math.round((index + 1) * size)),
  );
}

const SHAPE_TONE: Record<SyllableShape, number> = {
  level: 1,
  rising: 2,
  dipping: 3,
  falling: 4,
};

type ConvertTools = {
  pinyin: PinyinTools["pinyin"];
  convert?: (text: string, options: { format: "numToSymbol" }) => string;
};

/** The syllable said in another tone ("jiāo" for jiǎo said level), when it can be spelled. */
function soundsLike(
  syllable: ToneSyllable,
  heard: SyllableShape,
  tools: ConvertTools | null,
): string | null {
  if (!tools?.convert) return null;
  const numbered = String(
    tools.pinyin(syllable.character, { toneType: "num" }),
  );
  const plain = numbered.replace(/[0-9]$/, "");
  if (!plain) return null;
  return tools.convert(`${plain}${SHAPE_TONE[heard]}`, {
    format: "numToSymbol",
  });
}

/** A sentence on how a syllable's tone went and what to change. */
export function toneFeedback(
  result: SyllableResult,
  tools: ConvertTools | null = null,
): string {
  const { syllable, heard } = result;
  if (result.ok) {
    return {
      1: t`Good: high and level.`,
      2: t`Good: it rises.`,
      3: t`Good: low, with the dip.`,
      "half-3": t`Good: kept low.`,
      4: t`Good: a clear fall.`,
      0: t`Good: short and light.`,
    }[syllable.spoken];
  }
  if (!heard) return t`Too short to tell. Say it a little longer.`;
  const like = soundsLike(syllable, heard, tools);
  const yours = {
    level: like ? t`Yours stayed level, like ${like}.` : t`Yours stayed level.`,
    rising: like ? t`Yours rose, like ${like}.` : t`Yours rose.`,
    falling: like ? t`Yours fell, like ${like}.` : t`Yours fell.`,
    dipping: like ? t`Yours dipped, like ${like}.` : t`Yours dipped.`,
  }[heard];
  const aim = {
    1: t`Start high and hold it flat.`,
    2: t`Start in the middle and rise, as in a question.`,
    3: t`Start lower, dip, then come up.`,
    "half-3": t`Keep it low; don't come back up.`,
    4: t`Start high and drop sharply.`,
    0: t`Keep it short and light.`,
  }[syllable.spoken];
  return `${yours} ${aim}`;
}
