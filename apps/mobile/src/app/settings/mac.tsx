// Settings › Mac: pairing with Mirna on the Mac, and how the two get on once
// paired. The scanner and the "Paired" screen are their own routes
// (mac-scan, mac-paired) and reuse the pieces exported here.
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import {
  type ComponentProps,
  type ReactNode,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  CornerCurve,
  FontFamily,
  MirnaColors,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { confirmDestructive } from "@/lib/confirm";
import { syncBackgroundJob } from "@/mac-link/background";
import { LinkError } from "@/mac-link/bridge";
import type { SendMode } from "@/mac-link/model";
import {
  type PairedMac,
  pairWithScannedCode,
  unpairMac,
  usePairedMac,
} from "@/mac-link/pairing";
import {
  type MacReachability,
  useMacReachability,
} from "@/mac-link/reachability";
import {
  type LastSync,
  setIncludeMacNotes,
  setSendMode,
  useIncludeMacNotes,
  useLastSync,
  useSendMode,
} from "@/mac-link/schedule";
import { sendRecordingsToMac, type SendOutcome } from "@/mac-link/sender";
import { useMacLinkStatuses } from "@/mac-link/status";
import {
  createStyleHook,
  useAppColorScheme,
  useColors,
} from "@/settings/theme-provider";

import {
  currentNetworkKey,
  isIgnoringBatteryOptimizations,
  openAppSettings,
  PHONE_HOTSPOT_NETWORK,
  requestIgnoreBatteryOptimizations,
} from "../../../modules/mac-discovery";

export default function MacScreen() {
  const styles = useStyles();
  const { mac, loading } = usePairedMac();
  if (loading) return <SafeAreaView style={styles.page} />;
  return mac ? <PairedMacScreen mac={mac} /> : <PairStart />;
}

function PairedMacScreen({ mac }: { mac: PairedMac }) {
  const reach = useMacReachability();
  if (reach === "unreachable" || reach === "other") {
    return <CantReach mac={mac} />;
  }
  if (reach === "removed") return <Removed mac={mac} />;
  return <MacSettings mac={mac} reach={reach} />;
}

// --- Not paired ---------------------------------------------------------------

function PairStart() {
  const styles = useStyles();
  const router = useRouter();
  const [pasting, setPasting] = useState(false);
  return (
    <MacPage
      footer={
        <>
          <MacAction
            icon="scan-outline"
            label="Scan pairing code"
            onPress={() => router.push("/settings/mac-scan")}
          />
          {pasting ? (
            <PasteLink onPaired={() => router.push("/settings/mac-paired")} />
          ) : (
            <MacAction
              kind="text"
              label="Paste a pairing link instead"
              onPress={() => setPasting(true)}
            />
          )}
        </>
      }
    >
      <PairIllustration />
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Pair once, then it just works
        </Text>
        <Step number={1}>
          On your Mac, open Mirna and go to{" "}
          <Text style={styles.strong}>Settings › Phone</Text>.
        </Step>
        <Step number={2}>
          Click <Text style={styles.strong}>Pair a phone</Text>. A code appears.
        </Step>
        <Step number={3}>
          Scan it here. Both need to be on the same Wi-Fi, or the Mac on this
          phone’s hotspot.
        </Step>
      </View>
      <View style={styles.privacy}>
        <MutedIcon name="shield-outline" />
        <Text style={styles.privacyText}>
          Recordings go straight to your Mac over your Wi-Fi, encrypted so only
          these two devices can read them. No account, no cloud.
        </Text>
      </View>
    </MacPage>
  );
}

/** Phone, lock, laptop: the two devices and nothing in between. */
function PairIllustration() {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.illustration}
    >
      <Ionicons
        name="phone-portrait-outline"
        size={40}
        color={Colors.primary}
      />
      <View style={styles.link}>
        <View style={styles.linkDot} />
        <View style={styles.linkDot} />
        <View style={styles.lock}>
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={Colors.primary}
          />
        </View>
        <View style={styles.linkDot} />
        <View style={styles.linkDot} />
      </View>
      <Ionicons name="laptop-outline" size={54} color={Colors.primary} />
    </View>
  );
}

function Step({ number, children }: { number: number; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

// For when the camera can't scan: the Mac's "Copy pairing link" gives the same
// single-use code as the QR code.
export function PasteLink({ onPaired }: { onPaired: () => void }) {
  const styles = useStyles();
  const Colors = useColors();
  const [text, setText] = useState("");
  const pairing = useMutation({
    mutationFn: (value: string) => pairWithScannedCode(value),
    onSuccess: () => {
      void sendRecordingsToMac();
      onPaired();
    },
  });
  const submit = () => {
    const value = text.trim();
    if (value && !pairing.isPending) pairing.mutate(value);
  };
  return (
    <View style={styles.paste}>
      <TextInput
        accessibilityLabel="Pairing link"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder="mirna://pair?…"
        placeholderTextColor={Colors.muted}
        returnKeyType="go"
        style={styles.input}
        value={text}
      />
      <MacAction
        kind="outline"
        label="Pair"
        disabled={!text.trim()}
        loading={pairing.isPending}
        onPress={submit}
      />
      {pairing.error ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {pairingErrorText(pairing.error)}
        </Text>
      ) : null}
    </View>
  );
}

export function pairingErrorText(error: unknown) {
  if (error instanceof LinkError) {
    switch (error.code) {
      case "pairing_rejected":
        return "That code has expired or was already used. Show a new one on your Mac and scan again.";
      case "unreachable":
        return "Couldn't reach the Mac. Make sure Mirna is open on it, and that it's on the same Wi-Fi or on this phone's hotspot.";
      case "mac_mismatch":
        return "A different computer answered. Show a new code on your Mac and scan again.";
      case "invalid_offer":
        return "That isn't a Mirna pairing code.";
    }
  }
  return "Pairing didn't work. Try again.";
}

// --- Paired -------------------------------------------------------------------

function MacSettings({
  mac,
  reach,
}: {
  mac: PairedMac;
  reach: MacReachability;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const scheme = useAppColorScheme();
  const sendMode = useSendMode();
  const includeMacNotes = useIncludeMacNotes();
  const lastSync = useLastSync();
  const waiting = useWaitingOnPhone();
  const sync = useMutation({ mutationFn: () => sendRecordingsToMac("user") });
  const unpair = useMutation({ mutationFn: () => confirmAndUnpair(mac) });

  const nextMode = sendMode === "auto" ? "manual" : "auto";
  const syncCaption =
    sync.data && !sync.isPending
      ? outcomeText(sync.data)
      : sendMode === "manual"
        ? "Recordings wait on this phone until you tap Sync now. Audio never comes to the phone."
        : "Happens on its own on Wi-Fi; tap to sync right away. Audio never comes to the phone.";

  return (
    <MacPage
      footer={
        <View style={styles.unpair}>
          <MacAction
            kind="danger"
            label="Unpair"
            loading={unpair.isPending}
            onPress={() => unpair.mutate()}
          />
          <Text style={styles.centerCaption}>
            Your recordings stay on this phone. You can pair again any time.
          </Text>
        </View>
      }
    >
      <MacCard mac={mac} reach={reach} />

      <View style={styles.list}>
        <InfoRow
          label="Waiting on this phone"
          value={waiting === 0 ? "None" : recordingsLabel(waiting)}
        />
        <InfoRow
          label="Last synced"
          value={lastSyncLabel(lastSync)}
          detail={lastSync ? dayTimeLabel(lastSync.at) : undefined}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send recordings: ${sendModeLabel(sendMode)}`}
          accessibilityHint={`Changes to ${sendModeLabel(nextMode)}`}
          onPress={() =>
            void setSendMode(nextMode).then(() => syncBackgroundJob())
          }
          style={({ pressed }) => [
            styles.row,
            Platform.OS === "android" && styles.rowDivider,
            pressed && styles.rowPressed,
          ]}
        >
          <Text style={styles.rowLabel}>Send recordings</Text>
          <View style={styles.rowAction}>
            <Text style={styles.rowActionText}>{sendModeLabel(sendMode)}</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
          </View>
        </Pressable>
        {Platform.OS === "android" ? <BackgroundRow /> : null}
      </View>

      <View style={styles.switchCard}>
        <View style={styles.switchText}>
          <Text style={styles.rowLabel}>Notes made on the Mac</Text>
          <Text style={styles.caption}>
            Also show meetings recorded on the Mac. Text only.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Notes made on the Mac"
          accessibilityHint="Also show meetings recorded on the Mac. Text only."
          onValueChange={(value) => {
            // Turning it on fetches the Mac's notes straight away.
            void setIncludeMacNotes(value).then(() =>
              value ? sendRecordingsToMac("user") : undefined,
            );
          }}
          thumbColor="#FFFFFF"
          trackColor={{
            false: scheme === "dark" ? "#4A544E" : "#C9CEC6",
            true: Colors.primary,
          }}
          value={includeMacNotes}
        />
      </View>

      <View style={styles.sync}>
        <MacAction
          kind="outline"
          label="Sync now"
          loading={sync.isPending}
          onPress={() => sync.mutate()}
        />
        <Text accessibilityLiveRegion="polite" style={styles.centerCaption}>
          {syncCaption}
        </Text>
      </View>
    </MacPage>
  );
}

function MacCard({ mac, reach }: { mac: PairedMac; reach: MacReachability }) {
  const styles = useStyles();
  const Colors = useColors();
  const status =
    reach === "ok"
      ? currentNetworkKey() === PHONE_HOTSPOT_NETWORK
        ? "Connected · on your hotspot"
        : "Connected · same Wi-Fi"
      : reach === "no_wifi"
        ? "Not on Wi-Fi · recordings wait here"
        : "Checking…";
  const paired = `Paired ${shortDateLabel(mac.paired_at)}`;
  return (
    <View
      accessible
      accessibilityLabel={`${mac.mac_name}. ${status}. ${paired}.`}
      style={styles.macCard}
    >
      <View style={styles.macIcon}>
        <Ionicons name="laptop-outline" size={30} color={Colors.primary} />
      </View>
      <View style={styles.macText}>
        <Text style={styles.macName}>{mac.mac_name}</Text>
        <View style={styles.macStatus}>
          <View
            style={[styles.statusDot, reach !== "ok" && styles.statusDotIdle]}
          />
          <Text style={styles.macStatusText}>{status}</Text>
        </View>
        <Text style={styles.macDate}>{paired}</Text>
      </View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  const styles = useStyles();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}`}
      style={[styles.row, styles.rowDivider, styles.infoRow]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>
        <Text style={styles.rowValueText}>{value}</Text>
        {detail ? <Text style={styles.rowValueTime}>{detail}</Text> : null}
      </View>
    </View>
  );
}

/** "Runs in the background": tapping asks Android when it isn't allowed. */
function BackgroundRow() {
  const styles = useStyles();
  const Colors = useColors();
  const allowed = useBackgroundAllowed();
  if (allowed && !isColorOsPhone) {
    return (
      <View
        accessible
        accessibilityLabel="Runs in the background: Allowed"
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Runs in the background</Text>
        <AllowedValue />
      </View>
    );
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Runs in the background: ${allowed ? "Allowed" : "Not allowed"}`}
        accessibilityHint={
          allowed
            ? "Opens App info"
            : "Asks Android to let Mirna run in the background"
        }
        onPress={() => (allowed ? openAppSettings() : allowBackground())}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowLabel}>Runs in the background</Text>
        {allowed ? (
          <AllowedValue />
        ) : (
          <View style={styles.rowAction}>
            <Text style={[styles.rowActionText, styles.problem]}>
              Not allowed
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.destructive}
            />
          </View>
        )}
      </Pressable>
      {isColorOsPhone ? (
        <View style={styles.colorOsInRow}>
          <ColorOsHint />
        </View>
      ) : null}
    </View>
  );
}

function AllowedValue() {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View style={styles.rowAction}>
      <Ionicons name="checkmark" size={16} color={Colors.primary} />
      <Text style={styles.rowActionText}>Allowed</Text>
    </View>
  );
}

// --- Paired, but the Mac doesn't answer ---------------------------------------

function CantReach({ mac }: { mac: PairedMac }) {
  const styles = useStyles();
  const Colors = useColors();
  const queryClient = useQueryClient();
  const waiting = useWaitingOnPhone();
  const sendMode = useSendMode();
  const retry = useMutation({
    mutationFn: () =>
      Promise.all([
        sendRecordingsToMac("user"),
        queryClient.invalidateQueries({
          queryKey: ["mac-link", "reachability"],
        }),
      ]),
  });
  const unpair = useMutation({ mutationFn: () => confirmAndUnpair(mac) });

  const when =
    sendMode === "manual"
      ? "when you tap Sync now and the Mac answers"
      : "as soon as the Mac answers";
  const waitingText =
    waiting === 0
      ? "Nothing is waiting right now. New recordings stay safe on this phone until the Mac answers."
      : waiting === 1
        ? `1 recording is waiting safely on this phone. It'll go ${when}.`
        : `${waiting} recordings are waiting safely on this phone. They'll go ${when}.`;

  return (
    <MacPage
      footer={
        <>
          <MacAction
            label="Try again"
            loading={retry.isPending}
            onPress={() => retry.mutate()}
          />
          <MacAction
            kind="danger"
            label="Unpair"
            loading={unpair.isPending}
            onPress={() => unpair.mutate()}
          />
        </>
      }
    >
      <View accessibilityRole="alert" style={styles.alertCard}>
        <View style={styles.alertTitleRow}>
          <Ionicons
            name="alert-circle-outline"
            size={20}
            color={Colors.alertForeground}
          />
          <Text style={styles.alertTitle}>Can't reach {mac.mac_name}</Text>
        </View>
        <Text style={styles.alertBody}>{waitingText}</Text>
      </View>

      <Text accessibilityRole="header" style={styles.listTitle}>
        Check these
      </Text>
      <View style={styles.list}>
        <CheckItem
          icon="wifi-outline"
          title="Same Wi-Fi?"
          detail="The Mac and this phone must be on the same network, or the Mac on this phone’s hotspot. Guest networks often block this."
        />
        <CheckItem
          icon="laptop-outline"
          title="Is Mirna open on the Mac?"
          detail="It can run in the background, but not be fully quit."
        />
        <CheckItem
          icon="moon-outline"
          title="Is the Mac awake?"
          detail="A sleeping Mac can't receive. Open the lid or wake it."
          last
        />
      </View>
      {retry.isSuccess && !retry.isPending ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.centerCaption, styles.retryNote]}
        >
          Still no answer from {mac.mac_name}.
        </Text>
      ) : null}
    </MacPage>
  );
}

function CheckItem({
  icon,
  title,
  detail,
  last = false,
}: {
  icon: IconName;
  title: string;
  detail: string;
  last?: boolean;
}) {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${title} ${detail}`}
      style={[styles.checkItem, !last && styles.rowDivider]}
    >
      <Ionicons name={icon} size={22} color={Colors.primary} />
      <View style={styles.checkText}>
        <Text style={styles.checkTitle}>{title}</Text>
        <Text style={styles.checkDetail}>{detail}</Text>
      </View>
    </View>
  );
}

// --- The Mac forgot this phone ------------------------------------------------

function Removed({ mac }: { mac: PairedMac }) {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const pairAgain = useMutation({
    mutationFn: async () => {
      await unpairMac();
      await syncBackgroundJob();
    },
    onSuccess: () => router.push("/settings/mac-scan"),
  });
  return (
    <MacPage
      footer={
        <MacAction
          icon="scan-outline"
          label="Pair again"
          loading={pairAgain.isPending}
          onPress={() => pairAgain.mutate()}
        />
      }
    >
      <View accessibilityRole="alert" style={styles.alertCard}>
        <View style={styles.alertTitleRow}>
          <Ionicons
            name="alert-circle-outline"
            size={20}
            color={Colors.alertForeground}
          />
          <Text style={styles.alertTitle}>
            {mac.mac_name} removed this phone
          </Text>
        </View>
        <Text style={styles.alertBody}>
          To keep sending recordings, pair again. On your Mac, open Mirna ›
          Settings › Phone and click Pair a phone. Your recordings stay on this
          phone.
        </Text>
      </View>
    </MacPage>
  );
}

// --- Shared pieces ------------------------------------------------------------

/** The Mac page: back to Settings, the "Mac" title, and actions at the bottom. */
function MacPage({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/settings")
            }
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.primary} />
            <Text style={styles.backText}>Settings</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            Mac
          </Text>
          {children}
          <View style={styles.grow} />
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** The Mac screens' buttons, as in the mock-ups. */
export function MacAction({
  label,
  onPress,
  kind = "primary",
  small = false,
  icon,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "outline" | "text" | "danger";
  /** A primary button that hugs its label (inside a card). */
  small?: boolean;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const color =
    kind === "primary"
      ? Colors.primaryForeground
      : kind === "danger"
        ? Colors.destructive
        : Colors.primary;
  const kindStyle =
    kind === "primary"
      ? small
        ? styles.actionPrimarySmall
        : styles.actionPrimary
      : kind === "outline"
        ? styles.actionOutline
        : styles.actionText;
  const large = kind === "primary" && !small;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        kindStyle,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <View style={styles.actionContent}>
          {icon ? <Ionicons name={icon} size={22} color={color} /> : null}
          <Text
            style={[
              large ? styles.actionLabelLarge : styles.actionLabel,
              { color },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function MutedIcon({ name }: { name: IconName }) {
  const Colors = useColors();
  return <Ionicons name={name} size={18} color={Colors.muted} />;
}

// --- Running in the background (Android) --------------------------------------

/**
 * OPPO phones (and OnePlus and realme, on the same ColorOS) also keep their
 * own "Allow background activity" switch in App info › Battery usage.
 */
export const isColorOsPhone =
  Platform.OS === "android" &&
  /^(oppo|oneplus|realme)$/i.test(Device.manufacturer?.trim() ?? "");

function subscribeAppState(listener: () => void) {
  const subscription = AppState.addEventListener("change", listener);
  return () => subscription.remove();
}

/** Whether Android lets Mirna run with the screen off; checked again on return. */
export function useBackgroundAllowed(): boolean {
  return useSyncExternalStore(
    subscribeAppState,
    isIgnoringBatteryOptimizations,
  );
}

/** Shows Android's "Let Mirna run in the background?" dialog. */
export function allowBackground() {
  requestIgnoreBatteryOptimizations();
}

/** The extra step ColorOS phones need, with a way to get there. */
export function ColorOsHint() {
  const styles = useStyles();
  return (
    <View style={styles.colorOs}>
      <Text style={styles.caption}>
        On this phone, also open App info ›{" "}
        <Text style={styles.captionStrong}>
          Battery usage › Allow background activity
        </Text>
        .
      </Text>
      <View style={styles.colorOsAction}>
        <MacAction
          kind="text"
          label="Open App info"
          onPress={openAppSettings}
        />
      </View>
    </View>
  );
}

// --- Helpers ------------------------------------------------------------------

/**
 * Recordings not on the Mac yet. (needsMacContact would leave them out when
 * sending is manual, and count ones the Mac already has.)
 */
function useWaitingOnPhone(): number {
  const statuses = useMacLinkStatuses();
  let count = 0;
  for (const status of statuses.values()) {
    if (status.state === "waiting" || status.state === "sending") count += 1;
  }
  return count;
}

async function confirmAndUnpair(mac: PairedMac) {
  if (!(await confirmDestructive(`Unpair ${mac.mac_name}?`, "Unpair"))) return;
  await unpairMac();
  // Nothing needs the Mac any more, so the background job can stop.
  await syncBackgroundJob();
}

function sendModeLabel(mode: SendMode) {
  return mode === "auto"
    ? "Automatically on Wi-Fi"
    : "Only when I tap Sync now";
}

function recordingsLabel(count: number) {
  return count === 1 ? "1 recording" : `${count} recordings`;
}

function lastSyncLabel(lastSync: LastSync | null) {
  if (!lastSync) return "Not yet";
  if (lastSync.notes_failed) {
    const count =
      lastSync.notes_failed === 1
        ? "1 note couldn't be updated"
        : `${lastSync.notes_failed} notes couldn't be updated`;
    return lastSync.error ? `${count} (${lastSync.error})` : count;
  }
  if (lastSync.notes_updated === 0) return "Up to date";
  return lastSync.notes_updated === 1
    ? "1 note updated from the Mac"
    : `${lastSync.notes_updated} notes updated from the Mac`;
}

function startOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** "today 12:16", "yesterday 18:02", "21 Nov 09:30". */
function dayTimeLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${shortDateLabel(iso)} ${time}`;
}

/** "22 Nov", with the year when it isn't this year. */
function shortDateLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });
}

function outcomeText(outcome: SendOutcome) {
  switch (outcome) {
    case "nothing_to_send":
    case "done":
      return "Up to date with your Mac.";
    case "not_on_wifi":
      return "Connect to Wi-Fi to sync, or turn on your hotspot and join it from the Mac.";
    case "unpaired_by_mac":
      return "Your Mac no longer knows this phone. Pair again.";
    case "other_mac":
    case "mac_unreachable":
    case "backing_off":
    case "away":
      return "Couldn't reach the Mac. Is Mirna open on it, and is it on the same Wi-Fi or your hotspot?";
    case "not_paired":
      return "Not paired.";
    case "recording":
      return "Recording now. It syncs when you stop.";
  }
}

const useStyles = createStyleHook((Colors) => ({
  page: { flex: 1, backgroundColor: Colors.background },
  fill: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  grow: { flexGrow: 1, minHeight: Spacing.lg },
  footer: { gap: Spacing.xs },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },

  back: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 44,
    paddingRight: Spacing.sm,
    marginLeft: -Spacing.xs,
  },
  backText: {
    fontFamily: FontFamily.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.primary,
  },
  pageTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "600",
    letterSpacing: -0.4,
    color: Colors.ink,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },

  // Not paired
  illustration: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 26,
    borderRadius: Radius.panel,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.mutedSurface,
  },
  link: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: MirnaColors.sage,
  },
  lock: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  section: { gap: 14, paddingTop: 22, paddingHorizontal: Spacing.xs },
  sectionTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    color: Colors.primary,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.compact,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentSurface,
  },
  stepNumberText: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    color: Colors.primary,
  },
  stepText: { ...Typography.body, flex: 1, color: Colors.ink },
  strong: { fontWeight: "600" },
  privacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 20,
    paddingHorizontal: Spacing.xs,
  },
  privacyText: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    color: Colors.muted,
  },
  paste: { gap: Spacing.sm, paddingTop: Spacing.xs },
  input: {
    ...Typography.body,
    color: Colors.ink,
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  errorText: { ...Typography.body, color: Colors.destructive },

  // Paired
  macCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 18,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
  },
  macIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  macText: { flex: 1, gap: 3 },
  macName: {
    fontFamily: FontFamily.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    color: Colors.primary,
  },
  macStatus: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  statusDotIdle: { backgroundColor: MirnaColors.sage },
  macStatusText: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.primary,
    flexShrink: 1,
  },
  macDate: {
    ...Typography.time,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
  },

  list: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.card + 4,
    borderCurve: CornerCurve.squircle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.compact,
    minHeight: 52,
    paddingVertical: Spacing.xs,
  },
  infoRow: { alignItems: "flex-start", paddingVertical: 14 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowPressed: { opacity: 0.6 },
  rowLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.ink,
    flexShrink: 1,
  },
  rowValue: { alignItems: "flex-end", flexShrink: 1 },
  rowValueText: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: "right",
  },
  rowValueTime: {
    ...Typography.time,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.muted,
    textAlign: "right",
  },
  rowAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  rowActionText: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primary,
    textAlign: "right",
    flexShrink: 1,
  },
  problem: { color: Colors.destructive },
  colorOsInRow: { paddingBottom: Spacing.sm },
  colorOs: { gap: 2 },
  colorOsAction: { alignSelf: "flex-start", marginLeft: -Spacing.md },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: Spacing.compact,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.card + 4,
    borderCurve: CornerCurve.squircle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  switchText: { flex: 1, gap: 3 },
  caption: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
  },
  captionStrong: { fontWeight: "600", color: Colors.ink },
  sync: { gap: Spacing.sm, paddingTop: Spacing.md },
  centerCaption: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: "center",
  },
  retryNote: { marginTop: Spacing.md },
  unpair: { alignItems: "center", gap: Spacing.xs },

  // Can't reach / removed
  alertCard: {
    gap: Spacing.sm,
    padding: 18,
    borderRadius: 18,
    borderCurve: CornerCurve.squircle,
    borderWidth: 1,
    borderColor: Colors.alertBorder,
    backgroundColor: Colors.alert,
  },
  alertTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  alertTitle: {
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: Colors.alertForeground,
    flex: 1,
  },
  alertBody: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.alertForeground,
  },
  listTitle: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.ink,
    marginTop: 22,
    marginBottom: -Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 14,
  },
  checkText: { flex: 1, gap: 2 },
  checkTitle: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.ink,
  },
  checkDetail: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
  },

  // Buttons
  action: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.pill,
    borderCurve: CornerCurve.squircle,
    paddingHorizontal: Spacing.md,
  },
  actionPrimary: { height: 56, backgroundColor: Colors.primary },
  actionPrimarySmall: {
    minHeight: 44,
    paddingHorizontal: 20,
    backgroundColor: Colors.primary,
  },
  actionOutline: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  actionText: { minHeight: 44 },
  actionContent: { flexDirection: "row", alignItems: "center", gap: 10 },
  actionLabelLarge: {
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
  },
  actionLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
  },
}));
