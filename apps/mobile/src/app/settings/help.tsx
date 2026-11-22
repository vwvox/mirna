import Constants from "expo-constants";

import { SettingsPage, SettingsRow } from "@/settings/components";
import { FieldGroup } from "@/settings/field-group";
import { Text } from "@/settings/fields";

export default function AboutSettings() {
  return (
    <SettingsPage title="About">
      <FieldGroup.Section>
        <SettingsRow
          title="Version"
          value={Constants.expoConfig?.version ?? "Unknown"}
        />
        <FieldGroup.SectionFooter>
          <Text>
            Mirna records on this phone and sends recordings to Mirna on your
            Mac over your own network.
          </Text>
        </FieldGroup.SectionFooter>
      </FieldGroup.Section>
    </SettingsPage>
  );
}
