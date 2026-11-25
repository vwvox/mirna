import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { BottomSheet } from "@/components/bottom-sheet";
import { CornerCurve, Radius, Spacing, Typography } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import type { NoteJob } from "@/mac-link/bridge";
import { noteJobMessage } from "@/mac-link/model";
import { requestNoteJob } from "@/mac-link/sender";
import { createStyleHook, useColors } from "@/settings/theme-provider";

type Engine = Extract<NoteJob, { type: "retranscribe" }>["engine"];

const ENGINES: { engine: Engine; label: string; detail: string }[] = [
  {
    engine: "auto",
    label: "Automatic",
    detail:
      "Your Mac's settings. Switches to Qwen3-ASR when it hears Chinese or another language Parakeet doesn't know.",
  },
  {
    engine: "qwen3",
    label: "Qwen3-ASR",
    detail: "52 languages, including Chinese. Best when languages are mixed.",
  },
  {
    engine: "parakeet",
    label: "Parakeet",
    detail: "Fast. 25 European languages.",
  },
];

/** Asks the Mac to transcribe this note's recording again, with an engine. */
export function RetranscribeSheet({
  sessionId,
  macName,
  hasSummary,
  visible,
  onClose,
}: {
  sessionId: string;
  macName: string;
  hasSummary: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const [engine, setEngine] = useState<Engine>("auto");
  const [updateSummary, setUpdateSummary] = useState(true);
  const request = useMutation({
    mutationFn: () =>
      requestNoteJob(sessionId, {
        type: "retranscribe",
        engine,
        update_summary: hasSummary ? updateSummary : true,
      }),
    onSuccess: (outcome) => {
      showToast({
        id: `retranscribe-${sessionId}`,
        ...noteJobMessage(outcome, "retranscribe", macName),
      });
      if (outcome === "queued") onClose();
    },
    onError: () => {
      showToast({
        id: `retranscribe-${sessionId}`,
        ...noteJobMessage("mac_unreachable", "retranscribe", macName),
      });
    },
  });

  return (
    <BottomSheet
      visible={visible}
      title="Transcribe again on Mac"
      onClose={onClose}
    >
      <View accessibilityRole="radiogroup" style={styles.options}>
        {ENGINES.map((option) => {
          const selected = option.engine === engine;
          return (
            <Pressable
              key={option.engine}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setEngine(option.engine)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? Colors.primary : Colors.muted}
              />
              <View style={styles.optionCopy}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {hasSummary && (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Write the summary again too</Text>
          <Switch
            accessibilityLabel="Write the summary again too"
            value={updateSummary}
            onValueChange={setUpdateSummary}
          />
        </View>
      )}
      <Text style={styles.note}>
        {macName || "Your Mac"} does the work, so it needs to be on the same
        Wi-Fi with Mirna open.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={request.isPending}
        onPress={() => request.mutate()}
        style={({ pressed }) => [
          styles.primary,
          (pressed || request.isPending) && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>
          {request.isPending ? "Asking your Mac…" : "Transcribe again"}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

const useStyles = createStyleHook((Colors) => ({
  options: { gap: Spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    padding: Spacing.md,
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.accentSurface,
  },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { ...Typography.bodyStrong, color: Colors.ink },
  optionDetail: { ...Typography.caption, color: Colors.muted },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  switchLabel: { ...Typography.body, color: Colors.ink, flex: 1 },
  note: { ...Typography.caption, color: Colors.muted },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.primary,
  },
  primaryLabel: { ...Typography.bodyStrong, color: Colors.primaryForeground },
  pressed: { opacity: 0.7 },
}));
