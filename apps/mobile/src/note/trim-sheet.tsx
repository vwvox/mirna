import { useMutation } from "@tanstack/react-query";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";

import { BottomSheet } from "@/components/bottom-sheet";
import { CornerCurve, Radius, Spacing, Typography } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { noteJobMessage, wavDurationMs } from "@/mac-link/model";
import { createStyleHook } from "@/settings/theme-provider";

import { sampleLevels, trimRecording } from "./trim";
import {
  clampKeep,
  formatClock,
  formatLength,
  suggestKeep,
  trimChoices,
} from "./trim-model";
import type { useNoteAudio } from "./use-note-audio";

type NoteAudio = ReturnType<typeof useNoteAudio>;

const BARS = 72;
const PREVIEW_MS = 5_000;

/** Cuts the end off a recording that ran on too long. */
export function TrimSheet({
  sessionId,
  audio,
  macName,
  hasSummary,
  visible,
  onClose,
}: {
  sessionId: string;
  audio: NoteAudio;
  macName: string;
  hasSummary: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} title="Trim recording" onClose={onClose}>
      {visible && (
        <TrimControls
          sessionId={sessionId}
          audio={audio}
          macName={macName}
          hasSummary={hasSummary}
          onClose={onClose}
        />
      )}
    </BottomSheet>
  );
}

function TrimControls({
  sessionId,
  audio,
  macName,
  hasSummary,
  onClose,
}: {
  sessionId: string;
  audio: NoteAudio;
  macName: string;
  hasSummary: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const sampled = useMemo(
    () =>
      audio.availableLocally && audio.file ? sampleLevels(audio.file) : null,
    [audio.availableLocally, audio.file],
  );
  const lengthMs =
    sampled?.lengthMs ??
    (audio.data
      ? (wavDurationMs(audio.data.filename, audio.data.sizeBytes) ?? 0)
      : 0);
  const suggestion = useMemo(
    () => (sampled ? suggestKeep(sampled.levels, sampled.lengthMs) : null),
    [sampled],
  );
  const choices = trimChoices(lengthMs);
  const [keepMs, setKeepMs] = useState(
    () => suggestion ?? choices[0]?.keepMs ?? lengthMs,
  );
  const [updateSummary, setUpdateSummary] = useState(true);
  const cutMs = Math.max(0, lengthMs - keepMs);

  const trim = useMutation({
    mutationFn: () =>
      trimRecording({
        sessionId,
        filename: audio.data?.filename ?? null,
        availableLocally: audio.availableLocally,
        keepMs,
        updateSummary: hasSummary ? updateSummary : true,
      }),
    onSuccess: (outcome) => {
      if (outcome.ok) {
        showToast({
          id: `trim-${sessionId}`,
          ...(outcome.onMac
            ? noteJobMessage("queued", "trim", macName)
            : {
                title: "Recording trimmed",
                description: `Cut the last ${formatLength(cutMs)}.`,
              }),
        });
        onClose();
      } else {
        showToast({
          id: `trim-${sessionId}`,
          ...noteJobMessage(outcome.reason, "trim", macName),
        });
      }
    },
    onError: () => {
      showToast({
        id: `trim-${sessionId}`,
        ...noteJobMessage("failed", "trim", macName),
      });
    },
  });

  if (lengthMs <= 0) {
    return (
      <Text style={styles.body}>
        This recording isn't on this phone, so it can't be trimmed here.
      </Text>
    );
  }

  return (
    <View style={styles.controls}>
      <Text style={styles.body}>
        This recording is {formatClock(lengthMs)} long. Choose where it should
        end.
      </Text>

      {suggestion !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setKeepMs(suggestion)}
          style={({ pressed }) => [
            styles.suggestion,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.suggestionText}>
            The talking seems to stop around {formatClock(suggestion - 30_000)}.{" "}
            <Text style={styles.suggestionAction}>End it there</Text>
          </Text>
        </Pressable>
      )}

      <View style={styles.chips}>
        {choices.map((choice) => {
          const selected = choice.keepMs === keepMs;
          return (
            <Pressable
              key={choice.minutes}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Cut the last ${choice.minutes} minutes`}
              onPress={() => setKeepMs(choice.keepMs)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>
                −{choice.minutes} min
              </Text>
            </Pressable>
          );
        })}
      </View>

      <CutSlider
        lengthMs={lengthMs}
        keepMs={keepMs}
        levels={sampled?.levels ?? null}
        onChange={setKeepMs}
      />
      <Text style={styles.readout}>
        Ends at {formatClock(keepMs)} · cuts {formatLength(cutMs)}
      </Text>

      {audio.availableLocally && audio.file && (
        <PreviewButton uri={audio.file.uri} keepMs={keepMs} />
      )}

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

      <Text style={styles.warning}>
        The cut part is deleted from this phone and from {macName || "your Mac"}
        , with its words in the transcript. This can't be undone.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={trim.isPending || cutMs < 1_000}
        onPress={() => trim.mutate()}
        style={({ pressed }) => [
          styles.primary,
          (pressed || trim.isPending || cutMs < 1_000) && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>
          {trim.isPending
            ? "Trimming…"
            : cutMs < 1_000
              ? "Choose where it ends"
              : `Cut the last ${formatLength(cutMs)}`}
        </Text>
      </Pressable>
    </View>
  );
}

/** The recording's loudness, with the part to cut dimmed, and a handle. */
function CutSlider({
  lengthMs,
  keepMs,
  levels,
  onChange,
}: {
  lengthMs: number;
  keepMs: number;
  levels: number[] | null;
  onChange: (keepMs: number) => void;
}) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, lengthMs, onChange });
  latest.current = { width, lengthMs, onChange };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => move(event.nativeEvent.locationX),
        onPanResponderMove: (event) => move(event.nativeEvent.locationX),
      }),
    [],
  );
  function move(x: number) {
    const { width, lengthMs, onChange } = latest.current;
    if (width <= 0) return;
    const fraction = Math.min(1, Math.max(0, x / width));
    onChange(clampKeep(fraction * lengthMs, lengthMs));
  }

  const bars = useMemo(() => {
    if (!levels || levels.length === 0) return null;
    const perBar = levels.length / BARS;
    const values = Array.from({ length: BARS }, (_, bar) => {
      const from = Math.floor(bar * perBar);
      const to = Math.max(from + 1, Math.floor((bar + 1) * perBar));
      return Math.max(...levels.slice(from, to));
    });
    const peak = Math.max(...values, 0.0001);
    return values.map((value) => Math.max(0.06, Math.sqrt(value / peak)));
  }, [levels]);

  const fraction = lengthMs > 0 ? keepMs / lengthMs : 1;
  const minute = 60_000;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Where the recording ends"
      accessibilityValue={{ text: formatClock(keepMs) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        onChange(
          clampKeep(
            keepMs +
              (event.nativeEvent.actionName === "increment" ? minute : -minute),
            lengthMs,
          ),
        )
      }
      onLayout={(event: LayoutChangeEvent) =>
        setWidth(event.nativeEvent.layout.width)
      }
      style={styles.slider}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={styles.bars}>
        {bars
          ? bars.map((height, index) => (
              <View
                key={index}
                style={[
                  styles.bar,
                  { height: `${Math.round(height * 100)}%` },
                  (index + 0.5) / BARS > fraction && styles.barCut,
                ]}
              />
            ))
          : null}
      </View>
      <View
        pointerEvents="none"
        style={[styles.cutShade, { left: `${fraction * 100}%` }]}
      />
      <View
        pointerEvents="none"
        style={[styles.handle, { left: `${fraction * 100}%` }]}
      />
    </View>
  );
}

/** Plays the last few seconds before the cut, to hear where it ends. */
function PreviewButton({ uri, keepMs }: { uri: string; keepMs: number }) {
  const styles = useStyles();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (
      stopAt.current !== null &&
      status.playing &&
      status.currentTime * 1000 >= stopAt.current
    ) {
      stopAt.current = null;
      player.pause();
    }
  }, [player, status.currentTime, status.playing]);

  const play = async () => {
    if (status.playing) {
      stopAt.current = null;
      player.pause();
      return;
    }
    stopAt.current = keepMs;
    await player.seekTo(Math.max(0, keepMs - PREVIEW_MS) / 1000);
    player.play();
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void play()}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryLabel}>
        {status.playing ? "Stop" : "Play the 5 s before the end"}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyleHook((Colors) => ({
  controls: { gap: Spacing.md },
  body: { ...Typography.body, color: Colors.ink },
  suggestion: {
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
    padding: Spacing.md,
  },
  suggestionText: { ...Typography.caption, color: Colors.ink },
  suggestionAction: { ...Typography.captionStrong, color: Colors.primary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.accentSurface,
  },
  chipLabel: { ...Typography.captionStrong, color: Colors.muted },
  chipLabelOn: { color: Colors.ink },
  slider: {
    height: 64,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    justifyContent: "center",
  },
  bars: {
    ...{ position: "absolute", top: 8, bottom: 8, left: 6, right: 6 },
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  bar: { flex: 1, borderRadius: 1, backgroundColor: Colors.primary },
  barCut: { backgroundColor: Colors.muted, opacity: 0.35 },
  cutShade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: Colors.scrim,
    opacity: 0.25,
  },
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    marginLeft: -1.5,
    backgroundColor: Colors.destructive,
  },
  readout: { ...Typography.captionStrong, color: Colors.muted },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  switchLabel: { ...Typography.body, color: Colors.ink, flex: 1 },
  warning: { ...Typography.caption, color: Colors.muted },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.destructive,
  },
  primaryLabel: { ...Typography.bodyStrong, color: Colors.primaryForeground },
  secondary: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryLabel: { ...Typography.bodyStrong, color: Colors.ink },
  pressed: { opacity: 0.6 },
}));
