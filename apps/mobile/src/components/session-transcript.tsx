import { memo, useMemo, useRef, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { Radius, Spacing, Typography } from "@/constants/theme";
import {
  useSessionTranscripts,
  type TranscriptSegment,
} from "@/data/transcripts";
import { loadPinyin, usePinyinPreference } from "@/note/pinyin";
import { annotatePinyin, hasHan, wrapTokens } from "@/note/pinyin-model";
import { createStyleHook } from "@/settings/theme-provider";

export function SessionTranscript({
  sessionId,
  live,
  recordingDetails,
}: {
  sessionId: string;
  live?: {
    status: "connecting" | "live" | "fallback";
    text: string;
  };
  recordingDetails?: ReactNode;
}) {
  const styles = useStyles();
  const { segments, isLoading, error } = useSessionTranscripts(sessionId, true);
  const listRef = useRef<FlatList<TranscriptSegment>>(null);
  const following = useRef(Boolean(live));
  const hasChinese = useMemo(
    () => segments.some((segment) => hasHan(segment.text)),
    [segments],
  );
  const [showPinyin, setShowPinyin] = usePinyinPreference();
  const pinyinOn = hasChinese && showPinyin;

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={styles.content}
      data={segments}
      keyExtractor={(item) => item.id}
      onScroll={({
        nativeEvent: { contentOffset, contentSize, layoutMeasurement },
      }) => {
        following.current =
          contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (live && following.current)
          listRef.current?.scrollToEnd({ animated: true });
      }}
      extraData={pinyinOn}
      ListHeaderComponent={
        hasChinese ? (
          <View style={styles.pinyinRow}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: showPinyin }}
              onPress={() => setShowPinyin(!showPinyin)}
              style={({ pressed }) => [
                styles.pinyinChip,
                showPinyin && styles.pinyinChipOn,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.pinyinChipLabel,
                  showPinyin && styles.pinyinChipLabelOn,
                ]}
              >
                {showPinyin ? "Pinyin on" : "Show pinyin"}
              </Text>
            </Pressable>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.turn}>
          <Text style={styles.speaker}>{item.speaker}</Text>
          {pinyinOn && hasHan(item.text) ? (
            <PinyinText text={item.text} />
          ) : (
            <Text selectable style={styles.transcriptText}>
              {item.text}
            </Text>
          )}
        </View>
      )}
      ListEmptyComponent={
        !live?.text ? (
          <Text style={styles.hint}>
            {isLoading
              ? "Loading transcript…"
              : error
                ? "Couldn't load the transcript. Reopen the transcript to retry."
                : live
                  ? live.status === "fallback"
                    ? "Your recording will be transcribed after you stop listening."
                    : "Your transcript will appear here as you speak."
                  : "No transcript yet."}
          </Text>
        ) : null
      }
      ListFooterComponent={
        <View>
          {Boolean(live?.text) && (
            <View style={styles.turn}>
              <Text style={styles.speaker}>Speaking…</Text>
              <Text style={styles.hint}>{live?.text}</Text>
            </View>
          )}
          {recordingDetails}
        </View>
      }
    />
  );
}

/** Chinese with pinyin over each character, wrapping like normal text. */
const PinyinText = memo(function PinyinText({ text }: { text: string }) {
  const styles = useStyles();
  const tokens = useMemo(
    () => wrapTokens(annotatePinyin(text, loadPinyin())),
    [text],
  );
  return (
    <View accessible accessibilityLabel={text} style={styles.pinyinFlow}>
      {tokens.map((token, index) =>
        token.pinyin === undefined ? (
          <Text key={index} style={styles.transcriptText}>
            {token.text}
          </Text>
        ) : (
          <View key={index} style={styles.ruby}>
            <Text style={styles.rubyPinyin}>{token.pinyin}</Text>
            <Text style={styles.transcriptText}>{token.text}</Text>
          </View>
        ),
      )}
    </View>
  );
});

const useStyles = createStyleHook((Colors) => ({
  list: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  turn: { paddingVertical: Spacing.sm, gap: Spacing.xs },
  speaker: { ...Typography.captionStrong, color: Colors.muted },
  transcriptText: { ...Typography.body, color: Colors.ink },
  hint: { ...Typography.caption, color: Colors.muted },
  pinyinRow: { flexDirection: "row", paddingTop: Spacing.sm },
  pinyinChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  pinyinChipOn: {
    backgroundColor: Colors.accentSurface,
    borderColor: Colors.accentSurface,
  },
  pinyinChipLabel: { ...Typography.captionStrong, color: Colors.muted },
  pinyinChipLabelOn: { color: Colors.ink },
  pressed: { opacity: 0.7 },
  pinyinFlow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  ruby: { alignItems: "center", marginHorizontal: 1 },
  rubyPinyin: { fontSize: 11, lineHeight: 13, color: Colors.muted },
}));
