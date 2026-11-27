import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { useAuth } from "@/auth/context";
import { ActionButtonCard } from "@/components/action-button-card";
import { MirnaWordmark } from "@/components/mirna-wordmark";
import { SearchPalette } from "@/components/search-palette";
import { SessionCard, useSessionCardDetails } from "@/components/session-card";
import { StartOrReturnButton } from "@/components/start-or-return-button";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  ControlSize,
  CornerCurve,
  FontFamily,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { importRecordingAsNewNote } from "@/data/import-voice-memo";
import { createSession, deleteSession } from "@/data/session";
import { useSidebarItemPreferences } from "@/data/sidebar-preferences";
import { useTimelineSessions, type TimelineSession } from "@/data/timeline";
import { confirmDestructive } from "@/lib/confirm";
import { captureOperationalError } from "@/lib/error-reporting";
import { scrollVisibility } from "@/lib/scroll-visibility";
import { usePairedMac } from "@/mac-link/pairing";
import {
  type MacReachability,
  useMacReachability,
} from "@/mac-link/reachability";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { useMacLinkStatuses } from "@/mac-link/status";
import {
  deviceHasActionButton,
  dismissActionButtonCard,
  useActionButtonSetup,
} from "@/quick-actions/action-button-setup";
import {
  createStyleHook,
  useAppColorScheme,
  useColors,
} from "@/settings/theme-provider";
import { useProviderAccess } from "@/settings/use-provider-access";

const START_BAR_HEIGHT = 56 + 14 + Spacing.sm;

export default function HomeScreen() {
  const styles = useStyles();
  const Colors = useColors();
  const scheme = useAppColorScheme();
  const router = useRouter();
  const auth = useAuth();
  const { items, isLoading, error, hasMore, loadMore, retry } =
    useTimelineSessions();
  const sidebarPreferences = useSidebarItemPreferences();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [searching, setSearching] = useState(false);
  const refresh = useMutation({
    mutationFn: () => sendRecordingsToMac("user"),
  });
  const { mac, loading: macLoading } = usePairedMac();
  const reachability = useMacReachability();
  const macStatuses = useMacLinkStatuses();
  const transcribesHere = useProviderAccess("stt");
  const sessionIds = useMemo(
    () =>
      items.flatMap((item) =>
        item.type === "session" ? [item.session.id] : [],
      ),
    [items],
  );
  const cardDetails = useSessionCardDetails(sessionIds);
  const importRecording = useMutation({
    mutationFn: () => importRecordingAsNewNote(auth.session?.user.id),
    onSuccess: (sessionId) => {
      if (sessionId) router.push(`/note/${sessionId}`);
    },
    onError: (error) => {
      captureOperationalError(error, {
        operation: "session_import",
        tags: { entry_point: "mobile_home" },
      });
    },
  });
  const actionButtonSetup = useActionButtonSetup();
  const showActionButtonCard =
    deviceHasActionButton &&
    actionButtonSetup.data !== undefined &&
    !actionButtonSetup.data.cardDismissed;
  const [buttonHeight, setButtonHeight] = useState(START_BAR_HEIGHT);
  const [buttonHidden, setButtonHidden] = useState(false);
  const scrollState = useSharedValue({ anchor: 0, hidden: false });
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const buttonProgress = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    const previous = scrollState.get();
    const next = scrollVisibility(
      previous,
      event.contentOffset.y,
      event.contentSize.height - event.layoutMeasurement.height,
    );
    scrollState.set(next);
  });
  useAnimatedReaction(
    () => contentHeight.get() - viewportHeight.get(),
    (maxOffset) => {
      if (maxOffset <= 0) scrollState.set({ anchor: 0, hidden: false });
    },
  );
  useAnimatedReaction(
    () => scrollState.get().hidden,
    (hidden, previous) => {
      if (hidden === previous) return;
      scheduleOnRN(setButtonHidden, hidden);
      const target = hidden ? 1 : 0;
      buttonProgress.set(
        reducedMotion
          ? withTiming(target, {
              duration: 150,
              easing: Easing.bezier(0.23, 1, 0.32, 1),
              reduceMotion: ReduceMotion.Never,
            })
          : withSpring(target, {
              duration: 400,
              dampingRatio: 1,
              overshootClamping: true,
            }),
      );
    },
  );
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: 1 - buttonProgress.get(),
    transform: [
      {
        translateY: reducedMotion
          ? 0
          : buttonProgress.get() * (buttonHeight + insets.bottom),
      },
    ],
  }));
  // Ref, not state: two taps in the same frame both pass a state check.
  const busyRef = useRef(false);

  const handleDelete = async (session: TimelineSession) => {
    const confirmed = await confirmDestructive(
      `Delete "${session.title || "Untitled"}"?`,
      "Delete",
    );
    if (!confirmed) return;
    try {
      await deleteSession(session.id);
    } catch (error) {
      captureOperationalError(error, {
        operation: "session_delete",
        tags: { entry_point: "mobile_home" },
      });
    }
  };

  const createAndOpen = async (listen = false) => {
    const entryPoint = listen ? "start_listening" : "new_note";
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const sessionId = await createSession({
        entryPoint,
        ownerUserId: auth.session?.user.id,
      });
      router.push({
        pathname: "/note/[id]",
        params: { id: sessionId, ...(listen && { listen: "1" }) },
      });
    } catch (error) {
      captureOperationalError(error, {
        operation: "session_create",
        tags: {
          entry_point: entryPoint,
        },
      });
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View accessibilityRole="header">
          <MirnaWordmark size={32} dark={scheme === "dark"} />
        </View>
        <View style={styles.headerActions}>
          <IconButton
            accessibilityLabel="Import a recording"
            disabled={importRecording.isPending}
            icon="import"
            iconSize={22}
            onPress={() => importRecording.mutate()}
          />
          <IconButton
            accessibilityLabel="Search notes"
            icon="search"
            iconSize={22}
            onPress={() => setSearching(true)}
          />
          <IconButton
            accessibilityLabel="Write a note"
            icon="new-note"
            iconSize={22}
            onPress={() => void createAndOpen()}
          />
          <Pressable
            accessibilityLabel="Settings"
            accessibilityRole="button"
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.headerButtonPressed,
            ]}
          >
            <Ionicons name="options-outline" size={22} color={Colors.ink} />
          </Pressable>
        </View>
      </View>

      {mac && (
        <MacPill
          macName={mac.mac_name}
          reachability={reachability}
          onPress={() => router.push("/settings/mac")}
        />
      )}

      <View style={styles.timeline}>
        <Animated.FlatList
          data={items}
          keyExtractor={(item) => item.key}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: buttonHeight + Spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_width, height) => contentHeight.set(height)}
          onLayout={(event) =>
            viewportHeight.set(event.nativeEvent.layout.height)
          }
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refresh.isPending}
              onRefresh={() => {
                if (!refresh.isPending) refresh.mutate();
              }}
              tintColor={Colors.muted}
              colors={[Colors.primary]}
              progressBackgroundColor={Colors.surface}
            />
          }
          ListHeaderComponent={
            !macLoading && !mac ? (
              <PairCard onPair={() => router.push("/settings/mac")} />
            ) : showActionButtonCard ? (
              <ActionButtonCard
                onConfigure={() => router.push("/action-button")}
                onDismiss={() => void dismissActionButtonCard()}
              />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {isLoading
                  ? "Loading notes…"
                  : error
                    ? "Couldn't load notes"
                    : "No notes yet"}
              </Text>
              {!isLoading && !error && (
                <Text style={styles.emptyBody}>
                  Start recording, or import a recording such as a call recorded
                  by your phone.
                </Text>
              )}
            </View>
          }
          ListFooterComponent={
            error ? (
              <Button
                label="Retry loading notes"
                onPress={retry}
                variant="ghost"
              />
            ) : items.length > 0 && (isLoading || hasMore) ? (
              <Button
                label="Load more notes"
                onPress={loadMore}
                loading={isLoading}
                variant="ghost"
              />
            ) : null
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <Text accessibilityRole="header" style={styles.sectionLabel}>
                  {item.label}
                </Text>
              );
            }
            const details = cardDetails.get(item.session.id);
            return (
              <SessionCard
                details={details}
                macAway={reachability === "no_wifi"}
                macStatus={mac ? macStatuses.get(item.session.id) : undefined}
                macName={mac?.mac_name}
                needsPairing={
                  !macLoading &&
                  !mac &&
                  !transcribesHere &&
                  details?.hasRecording === true &&
                  !details.transcribed
                }
                session={item.session}
                showFolder={sidebarPreferences.showFolder}
                showTags={sidebarPreferences.showTags}
                onPress={() => router.push(`/note/${item.session.id}`)}
                onDelete={() => void handleDelete(item.session)}
              />
            );
          }}
        />

        <Animated.View
          style={[styles.startBar, buttonStyle]}
          onLayout={(event) => setButtonHeight(event.nativeEvent.layout.height)}
          pointerEvents={buttonHidden ? "none" : "box-none"}
          accessibilityElementsHidden={buttonHidden}
          importantForAccessibility={
            buttonHidden ? "no-hide-descendants" : "auto"
          }
        >
          <StartOrReturnButton onStart={() => void createAndOpen(true)} />
        </Animated.View>
      </View>
      {searching && (
        <SearchPalette
          onClose={() => setSearching(false)}
          onOpenSession={(session) => {
            setSearching(false);
            router.push(`/note/${session.id}`);
          }}
          onDeleteSession={(session) => {
            setSearching(false);
            requestAnimationFrame(() => {
              void handleDelete(session);
            });
          }}
        />
      )}
    </SafeAreaView>
  );
}

/** Whether the paired Mac answers, linking to Settings › Mac. */
function MacPill({
  macName,
  reachability,
  onPress,
}: {
  macName: string;
  reachability: MacReachability;
  onPress: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const tone =
    reachability === "ok"
      ? "connected"
      : reachability === "no_wifi" || reachability === "checking"
        ? "away"
        : reachability === "not_paired"
          ? null
          : "problem";
  if (!tone) return null;
  const color =
    tone === "connected"
      ? Colors.primary
      : tone === "problem"
        ? Colors.alertForeground
        : Colors.muted;
  const label =
    reachability === "ok"
      ? `${macName} · Connected`
      : reachability === "checking"
        ? `Looking for ${macName}…`
        : reachability === "no_wifi"
          ? "Away from your Mac · recordings wait here"
          : `Can't reach ${macName} · see why`;
  return (
    <View style={styles.pillRow}>
      <Pressable
        accessibilityHint="Opens Mac settings"
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          tone === "connected"
            ? styles.pillConnected
            : tone === "problem"
              ? styles.pillProblem
              : styles.pillAway,
          pressed && styles.pillPressed,
        ]}
      >
        {tone === "connected" ? (
          <Ionicons name="laptop-outline" size={18} color={color} />
        ) : tone === "problem" ? (
          <Ionicons name="alert-circle-outline" size={18} color={color} />
        ) : reachability === "no_wifi" ? (
          <MaterialIcons name="wifi-off" size={18} color={color} />
        ) : (
          <Ionicons name="laptop-outline" size={18} color={color} />
        )}
        <Text style={[styles.pillText, { color }]} numberOfLines={1}>
          {reachability === "ok" ? (
            <>
              <Text style={styles.pillName}>{macName}</Text> · Connected
            </>
          ) : (
            label
          )}
        </Text>
      </Pressable>
    </View>
  );
}

/** First run: what pairing gives you, and the way to do it. */
function PairCard({ onPair }: { onPair: () => void }) {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <View style={styles.pairCard}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.pairIcons}
      >
        <Ionicons
          name="phone-portrait-outline"
          size={26}
          color={Colors.primary}
        />
        <View style={styles.pairDots}>
          <View style={[styles.pairDot, { opacity: 1 }]} />
          <View style={[styles.pairDot, { opacity: 0.6 }]} />
          <View style={[styles.pairDot, { opacity: 0.3 }]} />
        </View>
        <Ionicons name="laptop-outline" size={28} color={Colors.primary} />
      </View>
      <View style={styles.pairCopy}>
        <Text accessibilityRole="header" style={styles.pairTitle}>
          Pair with your Mac
        </Text>
        <Text style={styles.pairBody}>
          Record here. Your Mac turns it into a transcript and a summary, and
          sends them back. Nothing goes to the cloud.
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Pair now with your Mac"
        accessibilityRole="button"
        onPress={onPair}
        style={({ pressed }) => [
          styles.pairButton,
          pressed && styles.startButtonPressed,
        ]}
      >
        <Text style={styles.pairButtonLabel}>Pair now</Text>
      </Pressable>
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: Spacing.compact,
    paddingTop: Spacing.md,
    paddingBottom: 6,
  },
  headerActions: {
    flexDirection: "row",
    gap: 2,
  },
  headerButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.pill,
  },
  headerButtonPressed: {
    backgroundColor: Colors.accentSurface,
  },
  pillRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  pill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: ControlSize.default,
    paddingLeft: 14,
    paddingRight: Spacing.md,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillConnected: { backgroundColor: Colors.accentSurface },
  pillAway: {
    backgroundColor: Colors.mutedSurface,
    borderColor: Colors.border,
  },
  pillProblem: {
    backgroundColor: Colors.alert,
    borderColor: Colors.alertBorder,
  },
  pillPressed: { opacity: 0.7 },
  pillText: {
    flexShrink: 1,
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
  },
  pillName: { fontWeight: "600" },
  pairCard: {
    gap: 14,
    padding: 20,
    marginTop: Spacing.compact,
    marginBottom: Spacing.xs,
    borderRadius: 20,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.accentSurface,
  },
  pairIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pairDots: { flexDirection: "row", gap: 5 },
  pairDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.primary,
  },
  pairCopy: { gap: 6 },
  pairTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    color: Colors.primary,
  },
  pairBody: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
  },
  pairButton: {
    alignSelf: "flex-start",
    minHeight: ControlSize.default,
    justifyContent: "center",
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: Colors.primary,
  },
  pairButtonLabel: {
    fontFamily: FontFamily.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
  list: {
    flex: 1,
  },
  timeline: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
  },
  startBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  startButtonPressed: {
    opacity: 0.75,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  emptyTitle: {
    ...Typography.bodyStrong,
    color: Colors.ink,
  },
  emptyBody: {
    ...Typography.body,
    color: Colors.muted,
    textAlign: "center",
  },
  sectionLabel: {
    fontFamily: FontFamily.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: Colors.muted,
    paddingHorizontal: Spacing.xs,
    marginTop: Spacing.compact,
    marginBottom: Spacing.sm,
  },
}));
