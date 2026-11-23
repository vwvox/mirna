// Settings › Mac › Scan pairing code: a full-screen camera that reads the
// mirna://pair code Mirna shows in Settings › Phone on the Mac.
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  CornerCurve,
  DarkColors,
  FontFamily,
  MirnaColors,
  Radius,
  Spacing,
} from "@/constants/theme";
import { pairWithScannedCode } from "@/mac-link/pairing";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { createStyleHook } from "@/settings/theme-provider";

import { MacAction, PasteLink, pairingErrorText } from "./mac";

// The scanner is dark in both themes, like the camera it frames.
const Dark = {
  page: "#1C211E",
  scrim: "rgba(28, 33, 30, 0.45)",
  text: MirnaColors.paper,
  softText: "#F1EFE8",
  glass: "rgba(251, 250, 246, 0.12)",
  outline: "rgba(251, 250, 246, 0.4)",
  problem: DarkColors.alertForeground,
};

/** Ignore a code that just failed for this long, so it isn't retried in a loop. */
const RETRY_SAME_CODE_MS = 3000;

export default function ScanScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [pasting, setPasting] = useState(false);
  // Same-frame guards: the camera reports a code many times a second.
  const busy = useRef(false);
  const lastFailure = useRef<{ code: string; at: number } | null>(null);

  const paired = () => router.replace("/settings/mac-paired");
  const pairing = useMutation({
    mutationFn: (code: string) => pairWithScannedCode(code),
    onSuccess: () => {
      void sendRecordingsToMac();
      paired();
    },
    onError: (_error, code) => {
      busy.current = false;
      lastFailure.current = { code, at: Date.now() };
    },
  });

  const onCode = (code: string | undefined) => {
    if (busy.current || !code?.startsWith("mirna://pair")) return;
    const failed = lastFailure.current;
    if (failed?.code === code && Date.now() - failed.at < RETRY_SAME_CODE_MS) {
      return;
    }
    busy.current = true;
    pairing.mutate(code);
  };

  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/settings/mac");
  const frame = Math.min(260, width - 96);
  const granted = permission?.granted ?? false;

  return (
    <View style={styles.page}>
      <Stack.Screen
        options={{
          animation: "slide_from_bottom",
          contentStyle: { backgroundColor: Dark.page },
        }}
      />
      <StatusBar style="light" />
      {granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => onCode(result.data)}
        />
      ) : null}
      <View pointerEvents="none" style={styles.scrim} />

      <SafeAreaView style={styles.fill}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.fill}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close scanner"
              onPress={close}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={Dark.text} />
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              Scan pairing code
            </Text>
          </View>

          <View style={styles.middle}>
            {!permission ? null : granted ? (
              <>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.instruction, pairing.error && styles.problem]}
                >
                  {pairing.isPending ? (
                    "Pairing with your Mac…"
                  ) : pairing.error ? (
                    pairingErrorText(pairing.error)
                  ) : (
                    <>
                      Point the camera at the code in{" "}
                      <Text style={styles.strong}>
                        Mirna › Settings › Phone
                      </Text>{" "}
                      on your Mac.
                    </>
                  )}
                </Text>
                <Viewfinder size={frame} busy={pairing.isPending} />
              </>
            ) : (
              <View style={styles.permission}>
                <Text style={styles.instruction}>
                  Mirna needs the camera to scan the pairing code on your Mac.
                  The camera is used only for this.
                </Text>
                <MacAction
                  small
                  label={
                    permission.canAskAgain ? "Allow camera" : "Open Settings"
                  }
                  onPress={() =>
                    permission.canAskAgain
                      ? void requestPermission()
                      : void Linking.openSettings()
                  }
                />
              </View>
            )}
            <View style={styles.chip}>
              <Ionicons name="wifi" size={16} color={Dark.softText} />
              <Text style={styles.chipText}>Same Wi-Fi as your Mac</Text>
            </View>
          </View>

          <View style={styles.bottom}>
            {pasting ? (
              <View style={styles.sheet}>
                <PasteLink onPaired={paired} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Paste a pairing link instead"
                onPress={() => setPasting(true)}
                style={({ pressed }) => [
                  styles.pasteButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.pasteLabel}>
                  Paste a pairing link instead
                </Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/** Corner brackets with an Ipê line across, like the Mac's code frame. */
function Viewfinder({ size, busy }: { size: number; busy: boolean }) {
  const styles = useStyles();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size }]}
    >
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
      {busy ? (
        <ActivityIndicator color={Dark.text} size="large" />
      ) : (
        <View style={styles.scanLine} />
      )}
    </View>
  );
}

const CORNER = 44;
const CORNER_WIDTH = 4;
const CORNER_RADIUS = 18;

const useStyles = createStyleHook((Colors) => ({
  page: { flex: 1, backgroundColor: Dark.page },
  fill: { flex: 1 },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Dark.scrim,
  },
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.compact,
    paddingTop: Spacing.compact,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Dark.glass,
  },
  title: {
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: Dark.text,
  },
  middle: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 34,
    paddingHorizontal: Spacing.xl,
  },
  instruction: {
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 23,
    color: Dark.softText,
    textAlign: "center",
  },
  problem: { color: Dark.problem },
  strong: { fontWeight: "600" },
  permission: { alignItems: "center", gap: Spacing.md },
  frame: { alignItems: "center", justifyContent: "center" },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: Dark.text,
  },
  topLeft: {
    left: 0,
    top: 0,
    borderLeftWidth: CORNER_WIDTH,
    borderTopWidth: CORNER_WIDTH,
    borderTopLeftRadius: CORNER_RADIUS,
  },
  topRight: {
    right: 0,
    top: 0,
    borderRightWidth: CORNER_WIDTH,
    borderTopWidth: CORNER_WIDTH,
    borderTopRightRadius: CORNER_RADIUS,
  },
  bottomLeft: {
    left: 0,
    bottom: 0,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomWidth: CORNER_WIDTH,
    borderBottomLeftRadius: CORNER_RADIUS,
  },
  bottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: CORNER_WIDTH,
    borderBottomWidth: CORNER_WIDTH,
    borderBottomRightRadius: CORNER_RADIUS,
  },
  scanLine: {
    position: "absolute",
    left: 28,
    right: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: MirnaColors.ipe,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: Dark.glass,
  },
  chipText: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: Dark.softText,
  },
  bottom: { paddingHorizontal: Spacing.lg - 4, paddingBottom: Spacing.lg },
  pasteButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    borderCurve: CornerCurve.squircle,
    borderWidth: 1,
    borderColor: Dark.outline,
  },
  pasteLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Dark.text,
  },
  // The paste field sits on a themed card, like a small sheet over the camera.
  sheet: {
    padding: Spacing.md,
    borderRadius: Radius.panel,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.background,
  },
}));
