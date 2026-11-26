import { describe, expect, test } from "vitest";

import { resolveConfigValue } from ".";

import type { StoredSettingValues } from "~/settings/queries";
import type { SettingKey } from "~/settings/schema";

const cases = [
  {
    name: "uses legacy don't-save when audio retention is missing",
    key: "audio_retention",
    values: { save_recordings: false },
    expected: "none",
  },
  {
    name: "keeps explicit audio retention over legacy save_recordings",
    key: "audio_retention",
    values: { save_recordings: false, audio_retention: "oneMonth" },
    expected: "oneMonth",
  },
  {
    name: "parses stored array values without exposing malformed entries",
    key: "spoken_languages",
    values: { spoken_languages: '["en",2,"ko"]' },
    expected: ["en", "ko"],
  },
  {
    name: "keeps recording disclosure auto-post off until explicitly enabled",
    key: "consent_auto_send_chat",
    values: {},
    expected: false,
  },
  {
    name: "keeps automatic updates on until explicitly disabled",
    key: "automatic_updates",
    values: {},
    expected: true,
  },
  {
    name: "keeps remember speakers off until explicitly enabled",
    key: "remember_speakers",
    values: {},
    expected: false,
  },
  {
    name: "respects an explicit remember speakers opt-in",
    key: "remember_speakers",
    values: { remember_speakers: true },
    expected: true,
  },
  {
    name: "uses disabled legacy bounce preferences for the general setting",
    key: "notification_bounce",
    values: {
      notification_bounce_summary: true,
      notification_bounce_transcript: false,
    },
    expected: false,
  },
  {
    name: "prefers the explicit general bounce preference",
    key: "notification_bounce",
    values: {
      notification_bounce: true,
      notification_bounce_summary: false,
    },
    expected: true,
  },
] satisfies Array<{
  name: string;
  key: SettingKey;
  values: StoredSettingValues["values"];
  expected: unknown;
}>;

describe("resolveConfigValue", () => {
  test.each(cases)("$name", ({ key, values, expected }) => {
    expect(
      resolveConfigValue(key, {
        values,
        hasValues: new Set(Object.keys(values) as SettingKey[]),
      }),
    ).toEqual(expected);
  });
});
