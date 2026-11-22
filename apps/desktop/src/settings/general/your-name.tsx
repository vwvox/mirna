import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { Input } from "@anlg/ui/components/ui/input";

import { updateHuman, usePersonalContact } from "~/contacts/queries";
import { SettingRow } from "~/settings/setting-row";
import { useOwnerUserId } from "~/shared/owner-user";

/**
 * Your name labels your side of transcripts and tells the AI who is asking.
 * It's your own contact card, the same one Account › Your info edits.
 */
export function YourNameSetting() {
  const selfId = useOwnerUserId();
  const { data: self } = usePersonalContact(selfId ?? "");
  if (!selfId || self === undefined) return null;
  return (
    <YourNameField key={selfId} selfId={selfId} saved={self?.name ?? ""} />
  );
}

function YourNameField({ selfId, saved }: { selfId: string; saved: string }) {
  const { t } = useLingui();
  const [name, setName] = useState(saved);
  const save = () => {
    const next = name.trim();
    if (next !== saved.trim()) void updateHuman(selfId, { name: next });
  };

  return (
    <SettingRow
      title={<Trans>Your name</Trans>}
      description={
        <Trans>
          Labels your side of transcripts, and tells the AI who's asking.
        </Trans>
      }
    >
      {(labelProps) => (
        <Input
          {...labelProps}
          value={name}
          placeholder={t`Your name`}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
    </SettingRow>
  );
}
