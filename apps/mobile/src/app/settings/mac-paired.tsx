// Shown once, right after pairing: what happens from now on, and (on Android)
// a nudge to let Mirna keep running with the screen off.
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CornerCurve, FontFamily, Radius, Spacing } from "@/constants/theme";
import { usePairedMac } from "@/mac-link/pairing";
import { useSendMode } from "@/mac-link/schedule";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import {
  allowBackground,
  ColorOsHint,
  type IconName,
  isColorOsPhone,
  MacAction,
  useBackgroundAllowed,
} from "./mac";

export default function PairedScreen() {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const { mac } = usePairedMac();
  const manual = useSendMode() === "manual";
  const backgroundAllowed = useBackgroundAllowed();
  const [notNow, setNotNow] = useState(false);
  const done = () =>
    router.canGoBack() ? router.back() : router.replace("/settings/mac");

  return (
    <SafeAreaView style={styles.page}>
      <Stack.Screen options={{ animation: "fade" }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.check}
          >
            <Ionicons name="checkmark" size={36} color={Colors.primary} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            Paired with {mac?.mac_name ?? "your Mac"}
          </Text>
          <Text style={styles.lead}>
            {manual
              ? "Recordings go to your Mac when you tap Sync now. Your Mac writes the notes and sends them back here."
              : "From now on, recordings go to your Mac by themselves. Your Mac writes the notes and sends them back here."}
          </Text>
        </View>

        <View style={styles.facts}>
          {manual ? (
            <Fact
              icon="wifi-outline"
              title="Same Wi-Fi: tap Sync now"
              detail="In Settings › Mac. Or switch to sending automatically there."
            />
          ) : (
            <Fact
              icon="wifi-outline"
              title="Same Wi-Fi: it sends"
              detail="No button to press."
            />
          )}
          <Fact
            icon="moon-outline"
            title="Away, or Mac asleep: it waits"
            detail="Recordings stay safe on this phone until they can go."
          />
          <Fact
            icon="shield-outline"
            title="Only these two devices"
            detail="Encrypted end to end. No account, no cloud."
          />
        </View>

        {Platform.OS === "android" && !backgroundAllowed && !notNow ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              Keep recording with the screen off
            </Text>
            <Text style={styles.cardBody}>
              Your phone may close apps in the background to save battery. Allow
              Mirna so a long recording, or sending, doesn't stop.
            </Text>
            {isColorOsPhone ? <ColorOsHint /> : null}
            <View style={styles.cardActions}>
              <MacAction small label="Allow" onPress={allowBackground} />
              <MacAction
                kind="text"
                label="Not now"
                onPress={() => setNotNow(true)}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.grow} />
        <MacAction label="Done" onPress={done} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail: string;
}) {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${detail}`}
      style={styles.fact}
    >
      <View style={styles.factIcon}>
        <Ionicons name={icon} size={20} color={Colors.primary} />
      </View>
      <View style={styles.factText}>
        <Text style={styles.factTitle}>{title}</Text>
        <Text style={styles.factDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  page: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.roomy,
    paddingBottom: Spacing.lg,
  },
  grow: { flexGrow: 1, minHeight: Spacing.lg },
  hero: {
    alignItems: "center",
    gap: Spacing.compact,
    paddingHorizontal: Spacing.compact,
  },
  check: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentSurface,
  },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Colors.ink,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  lead: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.muted,
    textAlign: "center",
  },
  facts: { gap: Spacing.md, marginTop: 28, paddingHorizontal: Spacing.xs },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  factIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.mutedSurface,
  },
  factText: { flex: 1, gap: 2 },
  factTitle: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.ink,
  },
  factDetail: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
  },
  card: {
    gap: 10,
    marginTop: 26,
    padding: Spacing.md,
    borderRadius: Radius.card + 4,
    borderCurve: CornerCurve.squircle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  cardTitle: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.ink,
  },
  cardBody: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
  },
}));
