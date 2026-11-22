import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spacing, Typography } from "@/constants/theme";
import { usePairedMac } from "@/mac-link/pairing";
import { sendRecordingsToMac } from "@/mac-link/sender";
import {
  describeMacLink,
  type MacLinkState,
  useMacLinkStatus,
} from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

const icons: Record<MacLinkState, keyof typeof Ionicons.glyphMap> = {
  waiting: "time-outline",
  sending: "arrow-up-circle-outline",
  on_mac: "laptop-outline",
  transcribing: "laptop-outline",
  summarizing: "laptop-outline",
  done: "checkmark-circle-outline",
  failed: "alert-circle-outline",
};

// Where this recording is on its way to the Mac, which transcribes it.
export function RecordingSyncCard({ sessionId }: { sessionId: string }) {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const { mac, loading } = usePairedMac();
  const status = useMacLinkStatus(sessionId);
  const [sending, setSending] = useState(false);

  if (loading || !status) return null;

  if (!mac) {
    return (
      <Card style={styles.card} tone="muted">
        <View style={styles.statusRow}>
          <Ionicons name="phone-portrait-outline" size={17} color={Colors.muted} />
          <Text style={styles.status}>
            Saved on this phone. Pair with your Mac to transcribe it there.
          </Text>
        </View>
        <Button
          label="Pair with Mac"
          onPress={() => router.push("/settings/mac")}
          size="small"
          style={styles.button}
          variant="outline"
        />
      </Card>
    );
  }

  const canSendNow = status.state === "waiting" || status.state === "sending";
  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendRecordingsToMac();
    } finally {
      setSending(false);
    }
  };

  return (
    <Card style={styles.card} tone={status.state === "failed" ? "alert" : "muted"}>
      <View style={styles.statusRow}>
        <Ionicons name={icons[status.state]} size={17} color={Colors.muted} />
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {describeMacLink(status, mac.mac_name)}
        </Text>
      </View>
      {canSendNow && (
        <Button
          label="Send now"
          loading={sending}
          onPress={() => void handleSend()}
          size="small"
          style={styles.button}
          variant="outline"
        />
      )}
    </Card>
  );
}

const useStyles = createStyleHook((Colors) => ({
  card: {
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  status: {
    flex: 1,
    ...Typography.caption,
    color: Colors.muted,
  },
  button: {
    alignSelf: "flex-start",
  },
}));
