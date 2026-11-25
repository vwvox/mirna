import { useLingui } from "@lingui/react/macro";

import {
  commands as notificationCommands,
  events as notificationEvents,
  type NotificationEvent,
} from "@anlg/plugin-notification";
import { events as listenerEvents } from "@anlg/plugin-transcription";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { type LongRecordingAction, LongRecordingWatch } from "./long-recording";

import { useLatestRef } from "~/shared/hooks/useLatestRef";
import { listenerStore } from "~/store/zustand/listener/instance";
import { useTabs } from "~/store/zustand/tabs";

export const LONG_RECORDING_NOTIFICATION_PREFIX = "long-recording:";
const TICK_MS = 5_000;
const SAVED_NOTICE_SECONDS = 30;

export type LongRecordingAlert = "silence" | "check_in" | "paused" | "saved";

export type LongRecordingCopy = Record<
  LongRecordingAlert,
  {
    title: string;
    message: string;
    action: string | null;
    footer: { text: string; action: string } | null;
  }
>;

type GuardListener = {
  live: {
    status: string;
    sessionId: string | null;
    seconds: number;
    paused: boolean;
  };
  setPaused: (value: boolean) => Promise<boolean>;
  stop: () => void;
};

type GuardDeps = {
  getListener: () => GuardListener;
  notify: (alert: LongRecordingAlert, key: string) => Promise<void>;
  openNote: (sessionId: string) => void;
  now: () => number;
  newId?: () => string;
};

export function isLongRecordingNotificationKey(key: string | null | undefined) {
  return Boolean(key?.startsWith(LONG_RECORDING_NOTIFICATION_PREFIX));
}

export function parseLongRecordingNotificationKey(key: string) {
  if (!isLongRecordingNotificationKey(key)) {
    return null;
  }
  const [alert, sessionId] = key
    .slice(LONG_RECORDING_NOTIFICATION_PREFIX.length)
    .split(":");
  if (!sessionId || !isAlert(alert)) {
    return null;
  }
  return { alert, sessionId };
}

function isAlert(value: string | undefined): value is LongRecordingAlert {
  return (
    value === "silence" ||
    value === "check_in" ||
    value === "paused" ||
    value === "saved"
  );
}

/**
 * Looks after the recording this window owns: asks "Still recording?" after
 * 15 min with nobody talking, pauses after 30, stops and saves a pause nobody
 * came back to after 2 h, and checks in once at 2 h recorded.
 */
export function createLongRecordingGuard({
  getListener,
  notify,
  openNote,
  now,
  newId = () => crypto.randomUUID(),
}: GuardDeps) {
  let sessionId: string | null = null;
  let watch: LongRecordingWatch | null = null;
  let heard = false;

  const sync = () => {
    const { live } = getListener();
    const active = live.status === "active" ? live.sessionId : null;
    if (active !== sessionId) {
      sessionId = active;
      watch = active ? new LongRecordingWatch() : null;
      heard = false;
    }
    return watch && sessionId ? { watch, sessionId } : null;
  };

  const isCurrent = (id: string) => {
    const { live } = getListener();
    return live.status === "active" && live.sessionId === id;
  };

  const alert = (kind: LongRecordingAlert, id: string) =>
    notify(
      kind,
      `${LONG_RECORDING_NOTIFICATION_PREFIX}${kind}:${id}:${newId()}`,
    ).catch((error) => {
      console.error("[long-recording] failed to show notification", error);
    });

  const act = async (
    action: LongRecordingAction,
    current: { watch: LongRecordingWatch; sessionId: string },
  ) => {
    switch (action.type) {
      case "silence_alert":
        await alert("silence", current.sessionId);
        return;
      case "check_in":
        await alert("check_in", current.sessionId);
        return;
      case "silence_over":
        return;
      case "auto_pause":
        if (await getListener().setPaused(true)) {
          await alert("paused", current.sessionId);
        } else {
          current.watch.someoneIsThere();
        }
        return;
      case "auto_pause_expired": {
        const listener = getListener();
        if (isCurrent(current.sessionId) && listener.live.paused) {
          listener.stop();
          await alert("saved", current.sessionId);
        }
        return;
      }
    }
  };

  return {
    /** Every pause or resume, except Mirna's own automatic pause, means someone is there. */
    onPausedChange(paused: boolean) {
      const current = sync();
      if (current && !(paused && current.watch.autoPaused)) {
        current.watch.someoneIsThere();
      }
    },

    onSpeech(id: string) {
      if (id === sync()?.sessionId) {
        heard = true;
      }
    },

    async tick() {
      const current = sync();
      if (!current) {
        return;
      }
      const actions = current.watch.onTick(
        getListener().live.seconds * 1000,
        heard,
        now(),
      );
      heard = false;
      for (const action of actions) {
        await act(action, current);
      }
    },

    async onNotification(event: NotificationEvent) {
      const parsed = parseLongRecordingNotificationKey(event.key);
      if (!parsed) {
        return false;
      }
      const { alert: kind, sessionId: id } = parsed;
      const current = sync();
      const keepGoing = () => {
        if (current?.sessionId === id) {
          current.watch.someoneIsThere();
        }
      };

      switch (event.type) {
        case "notification_confirm":
          openNote(id);
          break;
        case "notification_accept":
          if (kind === "saved") {
            openNote(id);
          } else if (!isCurrent(id)) {
            break;
          } else if (kind === "paused") {
            await getListener().setPaused(false);
          } else {
            getListener().stop();
          }
          break;
        case "notification_footer_action":
          if (kind === "paused") {
            if (isCurrent(id)) {
              getListener().stop();
            }
          } else {
            keepGoing();
          }
          break;
        case "notification_dismiss":
          if (kind === "silence" || kind === "check_in") {
            keepGoing();
          }
          break;
      }
      return true;
    },
  };
}

export function LongRecordingGuard() {
  const { t } = useLingui();
  const openNew = useTabs((state) => state.openNew);
  const openNewRef = useLatestRef(openNew);
  const copy: LongRecordingCopy = {
    silence: {
      title: t`Still recording?`,
      message: t`Nobody has spoken for 15 min.`,
      action: t`Stop & save`,
      footer: { text: t`Recording on purpose?`, action: t`Keep going` },
    },
    check_in: {
      title: t`Recording for 2 h`,
      message: t`Still going?`,
      action: t`Stop & save`,
      footer: { text: t`Recording on purpose?`, action: t`Keep going` },
    },
    paused: {
      title: t`Paused after 30 min of quiet`,
      message: t`Nothing is lost. Resume to keep recording, or Mirna saves it in 2 h.`,
      action: t`Resume`,
      footer: { text: t`Finished?`, action: t`Stop & save` },
    },
    saved: {
      title: t`Recording saved`,
      message: t`It stayed paused for 2 h, so Mirna stopped and saved it.`,
      action: t`Open`,
      footer: null,
    },
  };
  const copyRef = useLatestRef(copy);

  useMountEffect(() => {
    const guard = createLongRecordingGuard({
      getListener: () => listenerStore.getState(),
      now: () => Date.now(),
      openNote: (sessionId) =>
        openNewRef.current({
          type: "sessions",
          id: sessionId,
          state: { view: null, autoStart: null, scheduledAutoStart: null },
        }),
      notify: async (alert, key) => {
        const text = copyRef.current[alert];
        const result = await notificationCommands.showNotification({
          key,
          title: text.title,
          message: text.message,
          timeout:
            alert === "saved" ? { secs: SAVED_NOTICE_SECONDS, nanos: 0 } : null,
          source: null,
          start_time: null,
          participants: null,
          event_details: null,
          action_label: text.action,
          action: null,
          action_menu: null,
          action_variant:
            alert === "silence" || alert === "check_in" ? "destructive" : null,
          options: null,
          footer: text.footer
            ? {
                text: text.footer.text,
                actionLabel: text.footer.action,
                icon: null,
              }
            : null,
          icon: null,
        });
        if (result.status === "error") {
          throw new Error(result.error);
        }
      },
    });

    const unsubscribe = listenerStore.subscribe((state, previous) => {
      if (state.live.paused !== previous.live.paused) {
        guard.onPausedChange(state.live.paused);
      }
    });
    const interval = setInterval(() => void guard.tick(), TICK_MS);

    let active = true;
    const unlisteners: (() => void)[] = [];
    const keep = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (active) {
          unlisteners.push(unlisten);
        } else {
          unlisten();
        }
      });
    };
    keep(
      listenerEvents.captureDataEvent.listen(({ payload }) => {
        if (payload.type === "speech_heard") {
          guard.onSpeech(payload.session_id);
        }
      }),
    );
    keep(
      notificationEvents.notificationEvent.listen(({ payload }) => {
        void guard.onNotification(payload);
      }),
    );

    return () => {
      active = false;
      unsubscribe();
      clearInterval(interval);
      unlisteners.forEach((unlisten) => unlisten());
    };
  });

  return null;
}
