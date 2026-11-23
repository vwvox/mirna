import { useMutation, useQuery } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";

import { authenticateForAppLock } from "@/settings/app-lock";
import { SettingsError, SettingsPage } from "@/settings/components";
import { FieldGroup } from "@/settings/field-group";
import { Switch, Text } from "@/settings/fields";
import {
  setPrivacyPreference,
  usePrivacyPreferences,
} from "@/settings/privacy-store";

export default function PrivacySettings() {
  const preferences = usePrivacyPreferences();
  const security = useQuery({
    queryKey: ["device-security"],
    queryFn: () => LocalAuthentication.getEnrolledLevelAsync(),
  });
  const save = useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: "analytics" | "errorReports" | "appLock";
      value: boolean;
    }) => {
      if (key === "appLock" && !(await authenticateForAppLock())) return;
      await setPrivacyPreference(key, value);
    },
  });
  return (
    <SettingsPage title="Privacy">
      <FieldGroup.Section>
        <Switch
          label="Lock app"
          value={preferences.appLock}
          disabled={save.isPending || !security.data}
          onValueChange={(value) => save.mutate({ key: "appLock", value })}
        />
        <FieldGroup.SectionFooter>
          <Text>
            {security.data === LocalAuthentication.SecurityLevel.NONE
              ? "Set up a device passcode to lock Mirna."
              : "Require Face ID, fingerprint, or your device passcode to open Mirna. Recording continues while the app is locked."}
          </Text>
        </FieldGroup.SectionFooter>
        <SettingsError error={save.error || security.error} />
      </FieldGroup.Section>
      <FieldGroup.Section>
        <FieldGroup.SectionFooter>
          <Text>
            Mirna has no account, analytics, or crash reports. Recordings go
            only to your own Mac.
          </Text>
        </FieldGroup.SectionFooter>
      </FieldGroup.Section>
    </SettingsPage>
  );
}
