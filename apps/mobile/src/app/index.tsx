import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
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
import { SearchPalette } from "@/components/search-palette";
import { SessionCard } from "@/components/session-card";
import { StartListeningButton } from "@/components/start-listening-button";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { UserAvatarButton } from "@/components/user-avatar";
import {
  LISTENING_CONTROL_HEIGHT,
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
import {
  deviceHasActionButton,
  dismissActionButtonCard,
  useActionButtonSetup,
} from "@/quick-actions/action-button-setup";
import { usePairedMac } from "@/mac-link/pairing";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { useMacLinkStatuses } from "@/mac-link/status";
import { createStyleHook, useColors } from "@/settings/theme-provider";

export default function HomeScreen() {
  const styles = useStyles();
  const Colors = useColors();
  const router = useRouter();
  const auth = useAuth();
  const { items, isLoading, error, hasMore, loadMore, retry } =
    useTimelineSessions();
  const sidebarPreferences = useSidebarItemPreferences();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [searching, setSearching] = useState(false);
  const refresh = useMutation({ mutationFn: sendRecordingsToMac });
  const { mac, loading: macLoading } = usePairedMac();
  const macStatuses = useMacLinkStatuses();
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
  const [buttonHeight, setButtonHeight] = useState(
    LISTENING_CONTROL_HEIGHT + Spacing.xs,
  );
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
        <UserAvatarButton
          accessibilityLabel="Open settings"
          onPress={() => router.push("/settings")}
          user={auth.session?.user ?? null}
        />
        <View style={styles.headerActions}>
          <IconButton
            accessibilityLabel="Create new note"
            icon="new-note"
            onPress={() => void createAndOpen()}
          />
          <IconButton
            accessibilityLabel="Import a recording"
            disabled={importRecording.isPending}
            icon="import"
            onPress={() => importRecording.mutate()}
          />
          <IconButton
            accessibilityLabel="Search meetings"
            icon="search"
            onPress={() => setSearching(true)}
          />
        </View>
      </View>

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
              colors={[Colors.muted]}
              progressBackgroundColor={Colors.background}
            />
          }
          ListHeaderComponent={
            !macLoading && !mac ? (
              <View style={styles.pairCard}>
                <Text style={styles.pairTitle}>Pair with your Mac</Text>
                <Text style={styles.pairBody}>
                  Recordings made here are sent to Mirna on your Mac over
                  Wi-Fi, which transcribes and summarizes them.
                </Text>
                <Button
                  label="Pair"
                  onPress={() => router.push("/settings/mac")}
                  size="small"
                  variant="outline"
                />
              </View>
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
                  ? "Loading meetings…"
                  : error
                    ? "Couldn't load meetings"
                    : "No meetings yet"}
              </Text>
              {!isLoading && !error && (
                <Text style={styles.emptyBody}>
                  Start listening, or import a recording such as a call recorded by your phone.
                </Text>
              )}
            </View>
          }
          ListFooterComponent={
            error ? (
              <Button
                label="Retry loading meetings"
                onPress={retry}
                variant="ghost"
              />
            ) : items.length > 0 && (isLoading || hasMore) ? (
              <Button
                label="Load more meetings"
                onPress={loadMore}
                loading={isLoading}
                variant="ghost"
              />
            ) : null
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return <Text style={styles.sectionLabel}>{item.label}</Text>;
            }
            return (
              <SessionCard
                macStatus={mac ? macStatuses.get(item.session.id) : undefined}
                macName={mac?.mac_name}
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
          style={[styles.listeningButton, buttonStyle]}
          onLayout={(event) => setButtonHeight(event.nativeEvent.layout.height)}
          pointerEvents={buttonHidden ? "none" : "box-none"}
          accessibilityElementsHidden={buttonHidden}
          importantForAccessibility={
            buttonHidden ? "no-hide-descendants" : "auto"
          }
        >
          <StartListeningButton onPress={() => void createAndOpen(true)} />
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

const useStyles = createStyleHook((Colors) => ({
  pairCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  pairTitle: { ...Typography.section, color: Colors.ink },
  pairBody: { ...Typography.body, color: Colors.muted },
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  headerActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  list: {
    flex: 1,
  },
  timeline: {
    flex: 1,
  },
  listeningButton: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
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
    ...Typography.section,
    color: Colors.muted,
    paddingHorizontal: Spacing.compact,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
}));
