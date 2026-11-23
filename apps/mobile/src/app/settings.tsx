import { Icon } from "@expo/ui";
import { useRouter } from "expo-router";

import { SettingsPage } from "@/settings/components";
import { SettingsMenuGroup, SettingsMenuLink } from "@/settings/menu";

export default function SettingsScreen() {
  const router = useRouter();
  return (
    <SettingsPage title="Settings" layout="menu">
      <SettingsMenuGroup>
        <SettingsMenuLink
          title="Mac"
          icon={Icon.select({
            ios: "laptopcomputer",
            android: import("@expo/material-symbols/laptop_mac.xml"),
          })}
          onPress={() => router.push("/settings/mac")}
        />
      </SettingsMenuGroup>
      <SettingsMenuGroup>
        <SettingsMenuLink
          title="Recording"
          icon={Icon.select({
            ios: "mic",
            android: import("@expo/material-symbols/mic.xml"),
          })}
          onPress={() => router.push("/settings/recording")}
        />
        <SettingsMenuLink
          title="Language & dictionary"
          icon={Icon.select({
            ios: "text.bubble",
            android: import("@expo/material-symbols/subtitles.xml"),
          })}
          onPress={() => router.push("/settings/transcription")}
        />
        <SettingsMenuLink
          title="Appearance"
          icon={Icon.select({
            ios: "sun.max",
            android: import("@expo/material-symbols/light_mode.xml"),
          })}
          onPress={() => router.push("/settings/appearance")}
        />
      </SettingsMenuGroup>
      <SettingsMenuGroup>
        <SettingsMenuLink
          title="Privacy"
          icon={Icon.select({
            ios: "hand.raised",
            android: import("@expo/material-symbols/privacy_tip.xml"),
          })}
          onPress={() => router.push("/settings/privacy")}
        />
        <SettingsMenuLink
          title="About"
          icon={Icon.select({
            ios: "info.circle",
            android: import("@expo/material-symbols/info.xml"),
          })}
          onPress={() => router.push("/settings/help")}
        />
      </SettingsMenuGroup>
    </SettingsPage>
  );
}
