import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamAlertAnswer,
  type AudioStreamBuffer,
  type AudioStreamStatus,
} from "expo-audio";
import { useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import {
  beginMobileCapture,
  endMobileCapture,
  setSessionRecording,
} from "@/audio/capture-lifecycle";
import { levelFromAmplitude, pushLevel } from "@/audio/level-meter";
import {
  AUTO_PAUSE_STOP_AFTER_MS,
  LongRecordingWatch,
  RECORDING_ALERTS,
  partTitle,
  type LongRecordingAction,
  type RecordingAlertKind,
} from "@/audio/long-recording";
import { pcmAmplitude } from "@/audio/pcm-wav";
import {
  CATALOG_RETRY_DELAYS_MS,
  isCapturePhase,
  isRecordingStartCancelled,
  phaseAfterStreamStatus,
  retryWithDelays,
  stopSourceFromStream,
  type RecorderPhase,
  type StopSource,
} from "@/audio/recorder-status";
import {
  continueInNextPart,
  SessionWavWriter,
} from "@/audio/session-wav-writer";
import { SpeechActivity } from "@/audio/speech-activity";
import {
  catalogSessionAudio,
  recordSessionCaptureStart,
} from "@/data/audio-catalog";
import { saveSessionFolder } from "@/data/folders";
import {
  SessionLiveTranscription,
  markSessionAudioTranscribed,
  type LiveTranscriptionStatus,
} from "@/data/live-transcription";
import { createSession, deleteSession } from "@/data/session";
import { generateSummaryAfterTranscription } from "@/data/summarize";
import { execute } from "@/db";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { captureAnalytics } from "@/lib/analytics";
import {
  logDiagnostic,
  logDiagnosticError,
  type DiagnosticDetail,
} from "@/lib/diagnostics";
import { captureOperationalError } from "@/lib/error-reporting";
import { showToast } from "@/lib/toast";
import { useMountEffect } from "@/lib/use-mount-effect";
import {
  endMeetingRecordingActivity,
  startMeetingRecordingActivity,
} from "@/live-activity/meeting-recording-activity";

const STREAM_SAMPLE_RATE = 16_000;
const STREAM_CHANNELS = 1;
// Android drops notification updates that come too fast, so title edits are
// sent once typing settles.
const NOTIFICATION_TITLE_DELAY_MS = 400;

export type { RecorderPhase, StopSource } from "@/audio/recorder-status";

export type RecorderFailure =
  | "permission_denied"
  | "notification_permission_denied"
  | "start_failed"
  | "media_services_reset"
  | "native_error"
  | "save_failed";

export type StopResult = "saved" | "failed" | "noop";

/** What the recorder is asking about; a notification asks the same. */
export type RecorderNotice = RecordingAlertKind | null;

// Session ids are random, never user content; the first part is enough to
// match a log line to a note.
const shortId = (sessionId: string) => sessionId.slice(0, 8);

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Where a new part's note goes: the same owner and folder as the last. */
async function loadPartSource(sessionId: string) {
  const rows = await execute<{
    owner_user_id: string | null;
    folder_path: string | null;
  }>(
    "SELECT owner_user_id, folder_path FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [sessionId],
  );
  return rows[0] ?? null;
}

export function useSessionRecorder(
  sessionId: string,
  enabled: boolean,
): {
  phase: RecorderPhase;
  failure: RecorderFailure | null;
  amplitude: number;
  /** Recent levels (0 to 1), newest last, for the level strip. */
  levels: number[];
  /** Recorded time, without paused time, across all parts. */
  durationMs: number;
  liveStatus: LiveTranscriptionStatus;
  liveTranscript: string;
  /** Pause and resume are available (Android). */
  canPause: boolean;
  /**
   * The note being recorded into: this screen's note, or after 3 hours the
   * note for a later part.
   */
  sessionId: string;
  /** The part being recorded, from 1. */
  part: number;
  notice: RecorderNotice;
  start: () => Promise<void>;
  stop: (source?: StopSource) => Promise<StopResult>;
  pause: () => void;
  resume: () => Promise<void>;
  retry: () => Promise<StopResult>;
  /** Answers a silence alert or the check-in from the app. */
  keepGoing: () => void;
  /** The note title for the recording notification. */
  setNotificationTitle: (title: string) => void;
} {
  const [phase, setPhaseState] = useState<RecorderPhase>("idle");
  const [failure, setFailure] = useState<RecorderFailure | null>(null);
  const [amplitude, setAmplitude] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [liveStatus, setLiveStatus] =
    useState<LiveTranscriptionStatus>("connecting");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [recordingSessionId, setRecordingSessionId] = useState(sessionId);
  const [part, setPart] = useState(1);
  const [notice, setNoticeState] = useState<RecorderNotice>(null);
  const phaseRef = useRef<RecorderPhase>("idle");
  const activeRef = useRef(true);
  const writerRef = useRef<SessionWavWriter | null>(null);
  const liveRef = useRef<SessionLiveTranscription | null>(null);
  const startGenerationRef = useRef(0);
  const startRef = useRef<Promise<void> | null>(null);
  const stopOperationRef = useRef<Promise<StopResult> | null>(null);
  const completionTrackedRef = useRef(false);
  const reportedFailureRef = useRef<string | null>(null);
  const durationRef = useRef(0);
  const levelsRef = useRef<number[]>([]);
  const resumeOperationRef = useRef<Promise<void> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notificationTitleRef = useRef<string | null>(null);
  const capturedSessionsRef = useRef(new Set<string>());
  const stopRef = useRef<(source: StopSource) => Promise<StopResult>>(
    async () => "noop",
  );
  // The part being recorded and what came before it.
  const sessionRef = useRef(sessionId);
  const partRef = useRef(1);
  const completedPartsMsRef = useRef(0);
  const partSavesRef = useRef(new Set<Promise<void>>());
  const switchingPartRef = useRef(false);
  // The silence watch, the check-in and the part switches.
  const speechRef = useRef(new SpeechActivity());
  const watchRef = useRef(new LongRecordingWatch());
  const noticeRef = useRef<RecorderNotice>(null);
  const autoPausedRef = useRef(false);
  const streamStatusRef = useRef<(status: AudioStreamStatus) => void>(
    () => {},
  );
  const alertAnswerRef = useRef<(answer: AudioStreamAlertAnswer) => void>(
    () => {},
  );

  const log = (
    event: string,
    detail?: DiagnosticDetail,
    level?: "info" | "warning" | "error",
  ) =>
    logDiagnostic(
      event,
      { session: shortId(sessionRef.current), part: partRef.current, ...detail },
      level,
    );

  const registerCapture = (session: string) => {
    if (capturedSessionsRef.current.has(session)) return;
    capturedSessionsRef.current.add(session);
    beginMobileCapture(session, () => stopRef.current("quick_action"));
  };

  const unregisterCapture = (session: string) => {
    if (!capturedSessionsRef.current.delete(session)) return;
    endMobileCapture(session);
  };

  const setPhase = (next: RecorderPhase) => {
    phaseRef.current = next;
    setSessionRecording(sessionRef.current, isCapturePhase(next));
    if (activeRef.current) setPhaseState(next);
  };

  const setNotice = (next: RecorderNotice) => {
    noticeRef.current = next;
    if (activeRef.current) setNoticeState(next);
  };

  const reportFailure = (
    reason: RecorderFailure,
    error: unknown,
    operation: string,
  ) => {
    if (reportedFailureRef.current !== reason) {
      reportedFailureRef.current = reason;
      captureAnalytics("recording_failed", { failure_stage: reason });
    }
    if (
      reason !== "permission_denied" &&
      reason !== "notification_permission_denied"
    ) {
      captureOperationalError(error, {
        operation,
        tags: { stage: reason },
      });
    } else {
      log("recording_unavailable", { reason }, "warning");
    }
    if (activeRef.current) setFailure(reason);
  };

  const showAlert = (kind: RecordingAlertKind) => {
    const copy = RECORDING_ALERTS[kind];
    let posted = false;
    try {
      posted =
        streamRef.current.showAlert?.(kind, copy.title, copy.text, copy.actions) ??
        false;
    } catch (error) {
      captureOperationalError(error, {
        operation: "recording_alert_show",
        tags: { kind },
      });
    }
    setNotice(kind);
    log("recording_alert_shown", {
      kind,
      posted,
      quiet_ms: Math.round(watchRef.current.quietMs),
      recorded_ms: durationRef.current,
    });
  };

  const clearAlert = (reason: string) => {
    const kind = noticeRef.current;
    if (!kind) return;
    try {
      streamRef.current.clearAlert?.();
    } catch (error) {
      captureOperationalError(error, { operation: "recording_alert_clear" });
    }
    setNotice(null);
    log("recording_alert_cleared", { kind, reason });
  };

  const markPaused = (source: string) => {
    autoPausedRef.current = false;
    watchRef.current.someoneIsThere();
    clearAlert("paused");
    setPhase("paused");
    log("recording_paused", { source, recorded_ms: durationRef.current });
  };

  const markResumed = (source: string) => {
    const afterAutomaticPause = autoPausedRef.current;
    autoPausedRef.current = false;
    watchRef.current.someoneIsThere();
    clearAlert("resumed");
    setPhase("recording");
    log("recording_resumed", {
      source,
      after_automatic_pause: afterAutomaticPause,
    });
  };

  // Nothing heard for 30 minutes: the mic goes off, nothing is lost, and
  // the native side stops and saves it if nobody resumes within 2 hours.
  const pauseAutomatically = (quietMs: number) => {
    if (phaseRef.current !== "recording") return;
    const stream = streamRef.current;
    if (!stream.pause) return;
    try {
      if (!stream.pause(AUTO_PAUSE_STOP_AFTER_MS)) return;
    } catch (error) {
      captureOperationalError(error, { operation: "recording_auto_pause" });
      return;
    }
    setPhase("paused");
    autoPausedRef.current = true;
    log("recording_paused", {
      source: "automatic",
      quiet_ms: Math.round(quietMs),
      recorded_ms: durationRef.current,
      stops_after_ms: AUTO_PAUSE_STOP_AFTER_MS,
    });
    showAlert("paused");
  };

  const catalogWithRetry = (
    session: string,
    writer: SessionWavWriter,
    partNumber: number,
  ) =>
    retryWithDelays(
      async (attempt) => {
        const startedAt = Date.now();
        await catalogSessionAudio(session, {
          source: "recording",
          filename: "audio.wav",
          contentType: "audio/wav",
        });
        logDiagnostic("recording_cataloged", {
          session: shortId(session),
          part: partNumber,
          attempt: attempt + 1,
          ms: Date.now() - startedAt,
          bytes: writer.sizeBytes,
        });
      },
      CATALOG_RETRY_DELAYS_MS,
      wait,
      (error, attempt, willRetry) =>
        logDiagnosticError(
          "recording_catalog_failed",
          error,
          {
            session: shortId(session),
            part: partNumber,
            attempt: attempt + 1,
            will_retry: willRetry,
            bytes: writer.sizeBytes,
          },
          willRetry ? "warning" : "error",
        ),
    );

  const finishLiveTranscription = async (
    session: string,
    live: SessionLiveTranscription | null,
  ): Promise<boolean> => {
    const liveComplete = await (live?.stop() ?? Promise.resolve(false));
    if (liveComplete) {
      await markSessionAudioTranscribed(session)
        .then(() => {
          generateSummaryAfterTranscription(session);
        })
        .catch((error) => {
          captureOperationalError(error, {
            operation: "transcription_live_mark_complete",
            tags: { mode: "live" },
          });
        });
    }
    return liveComplete;
  };

  // A finished part is saved like any stopped recording, while the next part
  // records. It goes to the Mac with the rest once the recording ends.
  const savePart = async (
    session: string,
    writer: SessionWavWriter,
    live: SessionLiveTranscription | null,
    partNumber: number,
  ) => {
    const startedAt = Date.now();
    try {
      if (!writer.isFinalized) {
        // Recovery repairs its header and saves it on the next launch.
        throw new Error("The part's file was not finished");
      }
      await catalogWithRetry(session, writer, partNumber);
      await finishLiveTranscription(session, live);
      logDiagnostic("recording_part_saved", {
        session: shortId(session),
        part: partNumber,
        ms: Date.now() - startedAt,
        audio_ms: Math.round(writer.durationMs),
      });
    } catch (error) {
      void live?.stop();
      logDiagnosticError("recording_part_save_failed", error, {
        session: shortId(session),
        part: partNumber,
      });
    } finally {
      unregisterCapture(session);
    }
  };

  // After 3 hours the recording carries on in a new note without stopping
  // the mic: Android won't let a backgrounded app start a new microphone
  // service, and the phone is usually in a pocket by then.
  const startNextPart = async (nextPart: number) => {
    if (switchingPartRef.current) {
      watchRef.current.partFailed();
      return;
    }
    switchingPartRef.current = true;
    const generation = startGenerationRef.current;
    const fromSession = sessionRef.current;
    const startedAt = Date.now();
    const title = partTitle(notificationTitleRef.current ?? "", nextPart);
    log("recording_part_switch_started", {
      next_part: nextPart,
      part_ms: Math.round(writerRef.current?.durationMs ?? 0),
    });
    let nextSession: string | null = null;
    let switchedOver = false;
    try {
      // Buffers keep going to this part's file until the new note exists.
      const source = await loadPartSource(fromSession);
      nextSession = await createSession({
        title,
        ownerUserId: source?.owner_user_id ?? undefined,
        entryPoint: "start_listening",
        trackCreated: false,
      });
      if (source?.folder_path) {
        await saveSessionFolder(nextSession, source.folder_path).catch(
          (error) => {
            captureOperationalError(error, {
              operation: "recording_part_folder",
              level: "warning",
            });
          },
        );
      }
      await recordSessionCaptureStart(nextSession);
      const writer = writerRef.current;
      if (
        generation !== startGenerationRef.current ||
        !isCapturePhase(phaseRef.current) ||
        sessionRef.current !== fromSession ||
        !writer
      ) {
        log("recording_part_switch_abandoned", {
          next_part: nextPart,
          phase: phaseRef.current,
        });
        void deleteSession(nextSession).catch((error) => {
          captureOperationalError(error, {
            operation: "recording_part_cleanup",
          });
        });
        return;
      }

      // From here on nothing awaits, so no buffer can arrive mid-switch:
      // the ones before it are in this part, the ones after in the next.
      // Registered before its file exists, so recovery leaves it alone.
      registerCapture(nextSession);
      let switched: ReturnType<typeof continueInNextPart>;
      try {
        switched = continueInNextPart(writer, nextSession);
      } catch (error) {
        unregisterCapture(nextSession);
        throw error;
      }
      const live = liveRef.current;
      const previousPart = partRef.current;
      completedPartsMsRef.current += writer.durationMs;
      writerRef.current = switched.next;
      switchedOver = true;
      liveRef.current = null;
      sessionRef.current = nextSession;
      partRef.current = nextPart;
      // The new part is marked as recording before the old one is not, so
      // the Mac sender never sees a gap between them.
      setSessionRecording(nextSession, true);
      setSessionRecording(fromSession, false);
      watchRef.current.partStarted();
      notificationTitleRef.current = title;
      try {
        streamRef.current.setNotificationTitle?.(title);
      } catch {}
      if (activeRef.current) {
        setRecordingSessionId(nextSession);
        setPart(nextPart);
      }
      log("recording_part_started", {
        previous_part_ms: Math.round(writer.durationMs),
        previous_bytes: writer.sizeBytes,
        switch_ms: Date.now() - startedAt,
      });
      if (switched.finalizeError) {
        logDiagnosticError("recording_wav_finalize_failed", switched.finalizeError, {
          session: shortId(fromSession),
          part: previousPart,
          stage: "part_switch",
        });
      }
      const save = savePart(fromSession, writer, live, previousPart);
      partSavesRef.current.add(save);
      void save.finally(() => partSavesRef.current.delete(save));
    } catch (error) {
      logDiagnosticError("recording_part_switch_failed", error, {
        session: shortId(fromSession),
        next_part: nextPart,
        switched: switchedOver,
      });
      // Once recording has moved to the new note, that note stays.
      if (!switchedOver) {
        if (nextSession) void deleteSession(nextSession).catch(() => {});
        watchRef.current.partFailed();
      }
    } finally {
      switchingPartRef.current = false;
    }
  };

  const handleWatchAction = (action: LongRecordingAction) => {
    switch (action.type) {
      case "silence_alert":
        showAlert("silence");
        break;
      case "silence_over":
        if (noticeRef.current === "silence") clearAlert("speech");
        break;
      case "check_in":
        showAlert("check_in");
        break;
      case "auto_pause":
        pauseAutomatically(action.quietMs);
        break;
      case "next_part":
        void startNextPart(action.part);
        break;
    }
  };

  const handleBuffer = (buffer: AudioStreamBuffer) => {
    // Buffers can still arrive just after a pause; they were captured
    // before it. Native sends none while paused.
    if (!isCapturePhase(phaseRef.current)) return;
    const writer = writerRef.current;
    if (!writer) return;
    try {
      writer.append(buffer.data, buffer.sampleRate, buffer.channels);
    } catch (error) {
      logDiagnosticError("recording_write_failed", error, {
        session: shortId(sessionRef.current),
        part: partRef.current,
        bytes: writer.sizeBytes,
      });
      reportFailure("save_failed", error, "recording_stream_write");
      setPhase("save_error");
      try {
        streamRef.current.stop();
      } catch {}
      void endMeetingRecordingActivity(sessionRef.current).catch(
        (activityError) => {
          captureOperationalError(activityError, {
            operation: "recording_live_activity_end",
          });
        },
      );
      return;
    }
    const generation = startGenerationRef.current;
    liveRef.current ??= new SessionLiveTranscription(
      sessionRef.current,
      buffer.sampleRate,
      buffer.channels,
      ({ status, text }) => {
        if (!activeRef.current || generation !== startGenerationRef.current) {
          return;
        }
        setLiveStatus(status);
        setLiveTranscript(text);
      },
    );
    liveRef.current?.sendAudio(buffer.data);
    const recordedMs = completedPartsMsRef.current + writer.durationMs;
    durationRef.current = Math.round(recordedMs);

    let speech = false;
    try {
      speech = speechRef.current.push(
        new Int16Array(buffer.data, 0, buffer.data.byteLength >> 1),
        buffer.sampleRate,
        buffer.channels,
      );
    } catch {}
    for (const action of watchRef.current.onAudio(recordedMs, speech)) {
      handleWatchAction(action);
    }

    if (activeRef.current) {
      const bufferAmplitude = pcmAmplitude(buffer.data);
      levelsRef.current = pushLevel(
        levelsRef.current,
        levelFromAmplitude(bufferAmplitude),
      );
      setAmplitude(bufferAmplitude);
      setLevels(levelsRef.current);
      setDurationMs(durationRef.current);
    }
  };

  const { stream } = useAudioStream({
    sampleRate: STREAM_SAMPLE_RATE,
    channels: STREAM_CHANNELS,
    encoding: "int16",
    onBuffer: handleBuffer,
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const performStart = async () => {
    const generation = ++startGenerationRef.current;
    const isCurrent = () =>
      activeRef.current && generation === startGenerationRef.current;
    const startedAt = Date.now();
    completionTrackedRef.current = false;
    durationRef.current = 0;
    levelsRef.current = [];
    sessionRef.current = sessionId;
    partRef.current = 1;
    completedPartsMsRef.current = 0;
    speechRef.current = new SpeechActivity();
    watchRef.current = new LongRecordingWatch();
    autoPausedRef.current = false;
    setNotice(null);
    setRecordingSessionId(sessionId);
    setPart(1);
    setDurationMs(0);
    setAmplitude(0);
    setLevels([]);
    setLiveStatus("connecting");
    setLiveTranscript("");
    setFailure(null);
    reportedFailureRef.current = null;
    setPhase("starting");
    registerCapture(sessionId);
    log("recording_start_requested");
    try {
      let permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        captureAnalytics("permission_requested", {
          permission: "microphone",
          entry_point: "start_listening",
          action: "request",
        });
        permission = await requestRecordingPermissionsAsync();
        captureAnalytics("permission_resolved", {
          permission: "microphone",
          entry_point: "start_listening",
          status: permission.granted ? "authorized" : "denied",
        });
      }
      if (!isCurrent()) return;
      if (!permission.granted) {
        reportFailure(
          "permission_denied",
          new Error("Microphone permission denied"),
          "recording_permission",
        );
        captureAnalytics("session_start_failed", {
          failure_stage: "microphone_permission",
        });
        unregisterCapture(sessionId);
        setPhase("unavailable");
        return;
      }

      if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
        const notificationPermission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (!isCurrent()) return;
        if (notificationPermission !== PermissionsAndroid.RESULTS.GRANTED) {
          reportFailure(
            "notification_permission_denied",
            new Error("Recording notification permission denied"),
            "recording_notification_permission",
          );
          unregisterCapture(sessionId);
          setPhase("unavailable");
          return;
        }
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
        interruptionMode: "doNotMix",
      });
      if (!isCurrent()) return;
      writerRef.current = new SessionWavWriter(sessionId);
      await recordSessionCaptureStart(sessionId);
      if (!isCurrent()) return;
      await stream.start();
      if (!isCurrent()) {
        phaseRef.current = "recording";
        return;
      }
      await startMeetingRecordingActivity(sessionId).catch((activityError) => {
        captureOperationalError(activityError, {
          operation: "recording_live_activity_start",
        });
      });
      captureAnalytics("recording_started", {
        entry_point: "mobile_recorder",
        transcription_mode: "live_with_batch_fallback",
      });
      captureAnalytics("session_started", {
        entry_point: "mobile_recorder",
        transcription_mode: "live_with_batch_fallback",
      });
      setPhase("recording");
      log("recording_started", {
        ms: Date.now() - startedAt,
        sample_rate: stream.sampleRate,
        channels: stream.channels,
      });
    } catch (error) {
      try {
        stream.stop();
      } catch {}
      try {
        writerRef.current?.closeAndDiscardEmpty();
      } catch (cleanupError) {
        captureOperationalError(cleanupError, {
          operation: "recording_start_cleanup",
        });
      }
      writerRef.current = null;
      void liveRef.current?.stop();
      liveRef.current = null;
      await endMeetingRecordingActivity(sessionId).catch((activityError) => {
        captureOperationalError(activityError, {
          operation: "recording_live_activity_end",
        });
      });
      unregisterCapture(sessionId);
      if (isRecordingStartCancelled(error)) {
        log("recording_start_cancelled");
        setPhase("idle");
        return;
      }
      reportFailure("start_failed", error, "recording_start");
      captureAnalytics("session_start_failed", {
        failure_stage: "capture_start",
      });
      setPhase("error");
    }
  };

  const start = (): Promise<void> => {
    const currentOperation = startRef.current;
    if (currentOperation) return currentOperation;
    if (
      !["idle", "unavailable", "interrupted", "error"].includes(
        phaseRef.current,
      )
    ) {
      return Promise.resolve();
    }
    const operation = performStart();
    startRef.current = operation;
    const clearOperation = () => {
      if (startRef.current === operation) startRef.current = null;
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  };

  useMountEffect(() => {
    activeRef.current = true;
    if (!enabled) return;
    void start();
  });

  // Also covers Pause, Resume and Stop & save in the notifications, which
  // run while the app is in the background.
  streamStatusRef.current = (status) => {
    const next = phaseAfterStreamStatus(phaseRef.current, status);
    if (next === "stop") {
      void stopRef.current(stopSourceFromStream(status.reason));
    } else if (next === "paused") {
      markPaused(status.reason ?? "notification");
    } else if (next === "recording") {
      markResumed(status.reason ?? "notification");
    }
  };

  alertAnswerRef.current = ({ kind, answer }) => {
    // The notification is already gone. Stop and Resume arrive as stream
    // status changes, with "alert" as their reason.
    log("recording_alert_answered", { kind, answer, from: "notification" });
    if (noticeRef.current === kind) setNotice(null);
    if (answer === "keep_going") watchRef.current.someoneIsThere();
  };

  useMountEffect(() => {
    const statusSubscription = stream.addListener(
      "audioStreamStatus",
      (status) => streamStatusRef.current(status),
    );
    const alertSubscription = stream.addListener(
      "audioStreamAlert",
      (answer) => alertAnswerRef.current(answer),
    );
    return () => {
      statusSubscription.remove();
      alertSubscription.remove();
    };
  });

  useMountEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returned = previousState !== "active" && nextState === "active";
      previousState = nextState;
      if (!returned) return;
      if (phaseRef.current === "unavailable") {
        void start();
      } else if (isCapturePhase(phaseRef.current)) {
        // Live Updates may just have been allowed in Settings. Android
        // applies that when the notification is posted again.
        try {
          streamRef.current.setNotificationTitle?.(notificationTitleRef.current);
        } catch {}
      }
    });
    return () => subscription.remove();
  });

  const performStop = async (source: StopSource): Promise<StopResult> => {
    const requestedAt = Date.now();
    await startRef.current?.catch(() => {});
    await resumeOperationRef.current?.catch(() => {});
    if (
      !["recording", "paused", "save_error", "error", "interrupted"].includes(
        phaseRef.current,
      )
    ) {
      return "noop";
    }
    const writer = writerRef.current;
    if (!writer) {
      await endMeetingRecordingActivity(sessionRef.current).catch(
        (activityError) => {
          captureOperationalError(activityError, {
            operation: "recording_live_activity_end",
          });
        },
      );
      return "noop";
    }
    const phaseBefore = phaseRef.current;
    // From here no part switch can happen: it needs a capture phase.
    setPhase("saving");
    const session = sessionRef.current;
    const partNumber = partRef.current;
    clearAlert("stopped");
    log("recording_stop_requested", {
      source,
      phase: phaseBefore,
      recorded_ms: durationRef.current,
      file_finished: writer.isFinalized,
    });

    if (writer.isFinalized) {
      // Try again after the file was finished: only the catalog is left.
      log("recording_save_retry", { step: "catalog" });
    } else {
      let stepAt = Date.now();
      try {
        streamRef.current.stop();
        log("recording_stream_stopped", { ms: Date.now() - stepAt });
      } catch (error) {
        // Buffers are ignored from now on, so the file can still be finished.
        logDiagnosticError("recording_stream_stop_failed", error, {
          session: shortId(session),
          part: partNumber,
        });
      }
      await endMeetingRecordingActivity(session).catch((activityError) => {
        captureOperationalError(activityError, {
          operation: "recording_live_activity_end",
        });
      });
      stepAt = Date.now();
      try {
        writer.finalize();
        log("recording_wav_finalized", {
          ms: Date.now() - stepAt,
          bytes: writer.sizeBytes,
          audio_ms: Math.round(writer.durationMs),
        });
      } catch (error) {
        logDiagnosticError("recording_save_failed", error, {
          session: shortId(session),
          part: partNumber,
          step: "finalize",
        });
        reportFailure("save_failed", error, "recording_save");
        setPhase("save_error");
        return "failed";
      }
    }

    try {
      await catalogWithRetry(session, writer, partNumber);
    } catch (error) {
      log("recording_save_failed", { step: "catalog" }, "error");
      reportFailure("save_failed", error, "recording_save");
      setPhase("save_error");
      return "failed";
    }

    // The audio is saved. What follows can't lose it.
    const live = liveRef.current;
    writerRef.current = null;
    liveRef.current = null;
    let transcriptionMode = "mac";
    try {
      // The Mac transcribes and summarizes every recording. A live
      // transcript (only with the user's own cloud key) stays on the phone
      // as a preview.
      if (await finishLiveTranscription(session, live)) {
        transcriptionMode = "live";
      }
    } catch (error) {
      captureOperationalError(error, { operation: "recording_live_finish" });
    }
    if (partSavesRef.current.size > 0) {
      await Promise.allSettled([...partSavesRef.current]);
    }
    void sendRecordingsToMac();
    if (!completionTrackedRef.current) {
      completionTrackedRef.current = true;
      const properties = {
        duration_seconds: Math.round(durationRef.current / 1_000),
        completion_reason: "user_stopped",
        transcription_requested: true,
        transcription_mode: transcriptionMode,
      };
      captureAnalytics("recording_completed", properties);
      captureAnalytics("session_completed", properties);
    }
    unregisterCapture(session);
    setFailure(null);
    setPhase("saved");
    log("recording_saved", {
      source,
      parts: partNumber,
      recorded_ms: durationRef.current,
      ms: Date.now() - requestedAt,
    });
    return "saved";
  };

  const stop = (source: StopSource = "app_button"): Promise<StopResult> => {
    const currentOperation = stopOperationRef.current;
    if (currentOperation) return currentOperation;
    const operation = performStop(source);
    stopOperationRef.current = operation;
    const clearOperation = () => {
      if (stopOperationRef.current === operation) {
        stopOperationRef.current = null;
      }
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  };

  const canPause = typeof stream.pause === "function";

  // The mic goes off but the recording, its notification and the wake lock
  // stay. Recorded time stops with it, since it is counted from the audio.
  const pause = () => {
    if (phaseRef.current !== "recording") return;
    try {
      if (streamRef.current.pause?.()) markPaused("app");
    } catch (error) {
      captureOperationalError(error, { operation: "recording_pause" });
    }
  };

  const performResume = async () => {
    const current = streamRef.current;
    if (!current.resume) return;
    try {
      await current.resume();
      // A stop or a notification resume may have got there first.
      if (phaseRef.current === "paused" && current.isPaused === false) {
        markResumed("app");
      }
    } catch (error) {
      captureOperationalError(error, { operation: "recording_resume" });
      showToast({
        id: "recording-resume-failed",
        title: "Couldn’t turn the mic back on",
        description: "Another app may be using it. Try again.",
      });
    }
  };

  const resume = (): Promise<void> => {
    const currentOperation = resumeOperationRef.current;
    if (currentOperation) return currentOperation;
    if (phaseRef.current !== "paused") return Promise.resolve();
    const operation = performResume();
    resumeOperationRef.current = operation;
    const clearOperation = () => {
      if (resumeOperationRef.current === operation) {
        resumeOperationRef.current = null;
      }
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  };

  const keepGoing = () => {
    const kind = noticeRef.current;
    if (kind !== "silence" && kind !== "check_in") return;
    watchRef.current.someoneIsThere();
    log("recording_alert_answered", { kind, answer: "keep_going", from: "app" });
    try {
      streamRef.current.clearAlert?.();
    } catch {}
    setNotice(null);
  };

  const setNotificationTitle = (title: string) => {
    notificationTitleRef.current = title;
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      try {
        streamRef.current.setNotificationTitle?.(title);
      } catch (error) {
        captureOperationalError(error, {
          operation: "recording_notification_title",
        });
      }
    }, NOTIFICATION_TITLE_DELAY_MS);
  };

  const retry = async (): Promise<StopResult> => {
    if (
      writerRef.current &&
      ["save_error", "interrupted", "error"].includes(phaseRef.current)
    ) {
      return stop("retry");
    }
    if (["unavailable", "interrupted", "error"].includes(phaseRef.current)) {
      await start();
    }
    return "noop";
  };

  stopRef.current = stop;
  useMountEffect(() => () => {
    activeRef.current = false;
    startGenerationRef.current += 1;
    clearTimeout(titleTimerRef.current);
    const release = () => {
      unregisterCapture(sessionRef.current);
      // A start cut short by leaving the screen never reaches a later phase.
      setSessionRecording(sessionRef.current, false);
      setSessionRecording(sessionId, false);
    };
    void stopRef.current("left_screen").then(release, release);
  });

  return {
    phase,
    failure,
    amplitude,
    levels,
    durationMs,
    liveStatus,
    liveTranscript,
    canPause,
    sessionId: recordingSessionId,
    part,
    notice,
    start,
    stop,
    pause,
    resume,
    retry,
    keepGoing,
    setNotificationTitle,
  };
}
