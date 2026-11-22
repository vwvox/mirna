import { useMutation, useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { ControlSize, Radius, Spacing, Typography } from "@/constants/theme";
import * as bridge from "@/mac-link/bridge";
import { LinkError } from "@/mac-link/bridge";
import {
  loadIdentity,
  pairWithScannedCode,
  targetFor,
  unpairMac,
  usePairedMac,
} from "@/mac-link/pairing";
import { sendRecordingsToMac, type SendOutcome } from "@/mac-link/sender";
import { createStyleHook } from "@/settings/theme-provider";

import { isOnLocalNetwork } from "../../../modules/mac-discovery";

export default function MacScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { mac, loading } = usePairedMac();
  const [scanning, setScanning] = useState(false);
  const [pasting, setPasting] = useState(false);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          icon="back"
          onPress={() => (scanning ? setScanning(false) : router.back())}
        />
        <Text style={styles.title}>Mac</Text>
        <View style={styles.spacer} />
      </View>
      {loading ? null : scanning ? (
        <Scanner onDone={() => setScanning(false)} />
      ) : mac ? (
        <PairedView />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.copy}>
            Pair this phone with Mirna on your Mac. Recordings you make here are
            sent to the Mac over your Wi-Fi, encrypted from end to end, and the
            Mac transcribes and summarizes them. Nothing goes through a server.
          </Text>
          <Text style={styles.copy}>
            On your Mac, open Mirna › Settings › Phone and choose “Pair a
            phone”. Then scan the code it shows.
          </Text>
          <Button label="Scan pairing code" onPress={() => setScanning(true)} />
          {pasting ? (
            <PasteLink />
          ) : (
            <Button
              label="Paste a pairing link instead"
              onPress={() => setPasting(true)}
              variant="ghost"
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Scanner({ onDone }: { onDone: () => void }) {
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const pairing = useMutation({
    mutationFn: (text: string) => pairWithScannedCode(text),
    onSuccess: () => {
      onDone();
      void sendRecordingsToMac();
    },
    onError: () => {
      handled.current = false;
    },
  });

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.body}>
        <Text style={styles.copy}>
          Mirna needs the camera to scan the pairing code on your Mac. The
          camera is used only for this.
        </Text>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.camera}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={(result) => {
            if (handled.current || pairing.isPending) return;
            if (!result.data?.startsWith("mirna://pair")) return;
            handled.current = true;
            pairing.mutate(result.data);
          }}
        />
      </View>
      <Text style={styles.copy}>
        {pairing.isPending
          ? "Pairing…"
          : pairing.error
            ? pairingErrorText(pairing.error)
            : "Point the camera at the code in Mirna › Settings › Phone on your Mac."}
      </Text>
    </View>
  );
}

// For when the camera can't scan: the Mac's "Copy pairing link" gives the same
// single-use code as the QR code.
function PasteLink() {
  const styles = useStyles();
  const [text, setText] = useState("");
  const pairing = useMutation({
    mutationFn: (value: string) => pairWithScannedCode(value),
    onSuccess: () => void sendRecordingsToMac(),
  });
  return (
    <View style={styles.paste}>
      <TextInput
        accessibilityLabel="Pairing link"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setText}
        placeholder="mirna://pair?…"
        style={styles.input}
        value={text}
      />
      <Button
        label="Pair"
        disabled={!text.trim()}
        loading={pairing.isPending}
        onPress={() => pairing.mutate(text.trim())}
      />
      {pairing.error ? (
        <Text style={styles.copy}>{pairingErrorText(pairing.error)}</Text>
      ) : null}
    </View>
  );
}

function pairingErrorText(error: unknown) {
  if (error instanceof LinkError) {
    switch (error.code) {
      case "pairing_rejected":
        return "That code has expired or was already used. Show a new one on your Mac and scan again.";
      case "unreachable":
        return "Couldn't reach the Mac. Make sure both are on the same Wi-Fi and Mirna is open on the Mac.";
      case "mac_mismatch":
        return "A different computer answered. Show a new code on your Mac and scan again.";
      case "invalid_offer":
        return "That isn't a Mirna pairing code.";
    }
  }
  return "Pairing didn't work. Try again.";
}

function PairedView() {
  const styles = useStyles();
  const { mac } = usePairedMac();
  const reachability = useQuery({
    queryKey: ["mac-link", "reachability", mac?.mac_id, mac?.last_host],
    enabled: !!mac,
    queryFn: async () => {
      if (!mac) return "unknown" as const;
      if (!isOnLocalNetwork()) return "no_wifi" as const;
      const identity = await loadIdentity();
      if (!identity) return "unknown" as const;
      try {
        const info = await bridge.info({
          identity,
          mac: targetFor(mac, null),
        });
        return info.paired ? ("ok" as const) : ("removed" as const);
      } catch (error) {
        return error instanceof LinkError && error.code === "mac_mismatch"
          ? ("other" as const)
          : ("unreachable" as const);
      }
    },
    refetchInterval: 15_000,
  });
  const [lastOutcome, setLastOutcome] = useState<SendOutcome | null>(null);
  const sendNow = useMutation({
    mutationFn: () => sendRecordingsToMac(),
    onSuccess: (outcome) => setLastOutcome(outcome),
  });
  const unpair = useMutation({ mutationFn: () => unpairMac() });

  if (!mac) return null;

  const reach = reachability.data;
  const statusText =
    reach === "ok"
      ? "Connected. New recordings are sent automatically."
      : reach === "no_wifi"
        ? "Not on Wi-Fi. Recordings wait on this phone until you're on the same Wi-Fi as your Mac."
        : reach === "removed"
          ? "Your Mac no longer knows this phone. Unpair and pair again."
          : reach === "unreachable" || reach === "other"
            ? "Can't reach the Mac right now. Open Mirna on the Mac and join the same Wi-Fi. Recordings wait safely on this phone."
            : "Checking…";

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card style={styles.card}>
        <Text style={styles.label}>Paired with</Text>
        <Text style={styles.macName}>{mac.mac_name}</Text>
        <Text style={styles.copy}>{statusText}</Text>
      </Card>
      <Button
        label="Send now"
        loading={sendNow.isPending}
        onPress={() => sendNow.mutate()}
        variant="outline"
      />
      {lastOutcome && !sendNow.isPending ? (
        <Text style={styles.copy}>{outcomeText(lastOutcome)}</Text>
      ) : null}
      <Button
        label="Unpair"
        loading={unpair.isPending}
        onPress={() => unpair.mutate()}
        variant="ghost"
      />
      <Text style={styles.small}>
        Unpairing stops sending. To remove this phone from the Mac too, open
        Mirna › Settings › Phone on the Mac.
      </Text>
    </ScrollView>
  );
}

function outcomeText(outcome: SendOutcome) {
  switch (outcome) {
    case "nothing_to_send":
      return "Everything is already on your Mac.";
    case "done":
      return "Up to date with your Mac.";
    case "not_on_wifi":
      return "Connect to Wi-Fi to send.";
    case "unpaired_by_mac":
      return "Your Mac no longer knows this phone. Unpair and pair again.";
    case "other_mac":
    case "mac_unreachable":
      return "Couldn't reach the Mac. Is Mirna open on it?";
    case "not_paired":
      return "Not paired.";
  }
}

const useStyles = createStyleHook((Colors) => ({
  page: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { ...Typography.section, color: Colors.ink },
  spacer: { width: ControlSize.default, height: ControlSize.default },
  body: { padding: Spacing.md, gap: Spacing.md },
  card: { gap: Spacing.xs, padding: Spacing.md },
  label: { ...Typography.caption, color: Colors.muted },
  macName: { ...Typography.section, color: Colors.ink },
  copy: { ...Typography.body, color: Colors.ink },
  small: { ...Typography.caption, color: Colors.muted },
  paste: { gap: Spacing.sm },
  input: {
    ...Typography.body,
    color: Colors.ink,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  camera: {
    aspectRatio: 1,
    width: "100%",
    borderRadius: Radius.card,
    overflow: "hidden",
    backgroundColor: Colors.mutedSurface,
  },
}));
