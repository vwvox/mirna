import { Trans, useLingui } from "@lingui/react/macro";
import { platform } from "@tauri-apps/plugin-os";

import type { WritingStyle } from "@anlg/plugin-dictation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@anlg/ui/components/ui/select";
import { Textarea } from "@anlg/ui/components/ui/textarea";

import { DictationRecoveryList } from "~/dictation/recovery";
import { type AppCategory, parseWritingStyle } from "~/dictation/styles";
import { parseContextExclusions } from "~/dictation/system";
import { useSetSettingValue } from "~/settings/queries";
import {
  SETTING_CONTROL_CLASS,
  SettingRow,
  SettingSwitchRow,
} from "~/settings/setting-row";
import { useConfigValue, useConfigValues } from "~/shared/config";

/** Optional dictation features, each off until the person turns it on. */
export function DictationEngineSettings() {
  const cleanup = useConfigValue("dictation_cleanup");
  const setCleanup = useSetSettingValue("dictation_cleanup");
  const voiceEdit = useConfigValue("dictation_voice_edit");
  const setVoiceEdit = useSetSettingValue("dictation_voice_edit");
  const context = useConfigValue("dictation_context");
  const setContext = useSetSettingValue("dictation_context");
  const learning = useConfigValue("dictation_learning");
  const setLearning = useSetSettingValue("dictation_learning");
  const ducking = useConfigValue("dictation_ducking");
  const setDucking = useSetSettingValue("dictation_ducking");
  const recovery = useConfigValue("dictation_recovery");
  const setRecovery = useSetSettingValue("dictation_recovery");

  return (
    <div className="flex flex-col gap-6">
      <SettingSwitchRow
        title={<Trans>Clean up dictation</Trans>}
        description={
          <Trans>
            Fixes punctuation and filler words, and turns "new line", "new
            paragraph" and counted items into line breaks and lists, with your
            cleanup model. If it takes longer than a few seconds, your words are
            inserted as spoken.
          </Trans>
        }
        checked={cleanup}
        onChange={setCleanup}
      />
      {cleanup && <WritingStyles />}
      <SettingSwitchRow
        title={<Trans>Edit selected text by voice</Trans>}
        description={
          <Trans>
            With text selected in another app, say how to change it. The
            selection is sent to your selected AI model and is left unchanged if
            editing fails.
          </Trans>
        }
        checked={voiceEdit}
        onChange={setVoiceEdit}
      />
      <SettingSwitchRow
        title={<Trans>Use what's on screen</Trans>}
        description={
          <Trans>
            Lets transcription and cleanup see a short snippet of the focused
            app to spell names right. Password fields, private windows and
            excluded apps are never read, and nothing is stored.
          </Trans>
        }
        checked={context}
        onChange={setContext}
      />
      {context && <ContextExclusions />}
      <SettingSwitchRow
        title={<Trans>Learn from your corrections</Trans>}
        description={
          <Trans>
            Reads the field once after you dictate and suggests dictionary words
            you corrected. Suggestions wait for your review in Dictionary.
          </Trans>
        }
        checked={learning}
        onChange={setLearning}
      />
      {platform() !== "linux" && (
        <SettingSwitchRow
          title={<Trans>Lower other audio while dictating</Trans>}
          description={
            <Trans>
              Turns down your speakers while you speak, then restores the level
              it changed.
            </Trans>
          }
          checked={ducking}
          onChange={setDucking}
        />
      )}
      <SettingSwitchRow
        title={<Trans>Keep unsent dictations</Trans>}
        description={
          <Trans>
            If a dictation can't be transcribed or inserted, keep it on this
            device for 24 hours so you can retry, copy or discard it.
          </Trans>
        }
        checked={recovery}
        onChange={setRecovery}
      />
      <DictationRecoveryList />
      <p className="text-muted-foreground text-xs">
        <Trans>Local transcription never falls back to a cloud provider.</Trans>
      </p>
    </div>
  );
}

const STYLE_CATEGORIES: AppCategory[] = ["personal", "work", "email", "other"];

function WritingStyles() {
  const { t } = useLingui();
  const values = useConfigValues([
    "dictation_style_personal",
    "dictation_style_work",
    "dictation_style_email",
    "dictation_style_other",
  ] as const);
  const setPersonal = useSetSettingValue("dictation_style_personal");
  const setWork = useSetSettingValue("dictation_style_work");
  const setEmail = useSetSettingValue("dictation_style_email");
  const setOther = useSetSettingValue("dictation_style_other");
  const setters: Record<AppCategory, (value: string) => void> = {
    personal: setPersonal,
    work: setWork,
    email: setEmail,
    other: setOther,
  };
  const titles: Record<AppCategory, string> = {
    personal: t`Personal messages`,
    work: t`Work messages`,
    email: t`Email`,
    other: t`Other apps`,
  };
  const apps: Record<AppCategory, string> = {
    personal: t`Messages, WhatsApp, Telegram, Signal, Discord`,
    work: t`Slack, Teams, Zoom chat`,
    email: t`Mail, Outlook, Spark, Superhuman`,
    other: t`Everything else, including browsers and Mirna`,
  };
  const styles: Array<{ value: WritingStyle; name: string; example: string }> =
    [
      {
        value: "formal",
        name: t`Formal`,
        example: t`"Sounds good. See you at 6."`,
      },
      {
        value: "casual",
        name: t`Casual`,
        example: t`"Sounds good. See you at 6"`,
      },
      {
        value: "veryCasual",
        name: t`Very casual`,
        example: t`"sounds good see you at 6"`,
      },
    ];

  return (
    <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">
          <Trans>Writing style</Trans>
        </h3>
        <p className="text-muted-foreground text-xs">
          <Trans>
            Cleanup matches how you write in each kind of app. Mirna reads which
            app you're typing into on this device; the app's name is never sent.
          </Trans>
        </p>
      </div>
      {STYLE_CATEGORIES.map((category) => (
        <SettingRow
          key={category}
          title={titles[category]}
          description={apps[category]}
        >
          {(labelProps) => {
            const value = parseWritingStyle(
              values[`dictation_style_${category}`],
            );
            return (
              <Select value={value} onValueChange={setters[category]}>
                <SelectTrigger
                  {...labelProps}
                  className={SETTING_CONTROL_CLASS}
                >
                  <SelectValue>
                    {styles.find((style) => style.value === value)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {styles.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.name}
                      <span className="text-muted-foreground ml-2">
                        {style.example}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }}
        </SettingRow>
      ))}
    </div>
  );
}

function ContextExclusions() {
  const { t } = useLingui();
  const stored = useConfigValue("dictation_context_exclusions");
  const setStored = useSetSettingValue("dictation_context_exclusions");
  const exclusions = parseContextExclusions(stored) ?? {
    apps: [],
    websites: [],
  };
  const save = (apps: string[], websites: string[]) =>
    setStored(JSON.stringify({ apps, websites }));

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm">
        <span>
          <Trans>Never read these apps</Trans>
        </span>
        <Textarea
          defaultValue={exclusions.apps.join("\n")}
          placeholder={t`One app name or bundle ID per line`}
          onBlur={(event) =>
            save(lines(event.target.value), exclusions.websites)
          }
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span>
          <Trans>Never read these websites</Trans>
        </span>
        <Textarea
          defaultValue={exclusions.websites.join("\n")}
          placeholder={t`One domain per line, like bank.example`}
          onBlur={(event) => save(exclusions.apps, lines(event.target.value))}
        />
      </label>
    </div>
  );
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200);
}
