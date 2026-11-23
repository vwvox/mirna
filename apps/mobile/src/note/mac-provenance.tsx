import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { FontFamily, Spacing } from "@/constants/theme";
import type { MacLinkStatus } from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import { recentMacUpdate } from "./mac-progress";

function clock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function when(date: Date) {
  return date.toDateString() === new Date().toDateString()
    ? `at ${clock(date)}`
    : `on ${date.toLocaleDateString([], { day: "numeric", month: "short" })} at ${clock(date)}`;
}

/**
 * Where the transcript and summary were made: a line saying the Mac made
 * them, or, after the Mac changed the note, a banner saying what changed.
 */
export function MacProvenance({
  status,
  macName,
  hasSummary,
}: {
  status: MacLinkStatus;
  macName: string;
  hasSummary: boolean;
}) {
  const styles = useStyles();
  const Colors = useColors();
  if (status.state !== "done") return null;

  const updated = recentMacUpdate(status);
  if (updated) {
    const added = status.mac_recordings?.length ?? 0;
    return (
      <View accessible accessibilityLiveRegion="polite" style={styles.banner}>
        <Ionicons
          name="refresh"
          size={18}
          color={Colors.primary}
          style={styles.bannerIcon}
        />
        <Text style={styles.bannerText}>
          Updated on {macName} {when(updated)}.{" "}
          {added === 1
            ? "A second recording was added there, so the transcript and summary were redone."
            : added > 1
              ? "More recordings were added there, so the transcript and summary were redone."
              : "The transcript and summary here match the Mac."}
        </Text>
      </View>
    );
  }

  const madeAt = status.updated_at ? new Date(status.updated_at) : null;
  const time =
    madeAt && Number.isFinite(madeAt.getTime()) ? ` · ${clock(madeAt)}` : "";
  return (
    <View accessible style={styles.line}>
      <View style={styles.check}>
        <Ionicons name="checkmark" size={13} color={Colors.primary} />
      </View>
      <Text style={styles.lineText}>
        {hasSummary ? "Transcribed and summarized" : "Transcribed"} on {macName}
        {time}
      </Text>
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  check: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: Colors.accentSurface,
  },
  lineText: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.primary,
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: Spacing.compact,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.accentSurface,
  },
  bannerIcon: { marginTop: 1 },
  bannerText: {
    flex: 1,
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.primary,
  },
}));
