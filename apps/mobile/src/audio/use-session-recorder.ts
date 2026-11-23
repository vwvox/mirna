import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";
import { useCallback, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import {
  beginMobileCapture,
  endMobileCapture,
  setSessionRecording,
} from "@/audio/capture-lifecycle";
import { levelFromAmplitude, pushLevel } from "@/audio/level-meter";
import { pcmAmplitude } from "@/audio/pcm-wav";
import {
  isCapturePhase,
  isRecordingStartCancelled,
  phaseAfterStreamStatus,
  type RecorderPhase,
} from "@/audio/recorder-status";
import { SessionWavWriter } from "@/audio/session-wav-writer";
import {
  catalogSessionAudio,
  recordSessionCaptureStart,
} from "@/data/audio-catalog";
import {
  SessionLiveTranscription,
  markSessionAudioTranscribed,
  type LiveTranscriptionStatus,
} from "@/data/live-transcription";
import { generateSummaryAfterTranscription } from "@/data/summarize";
import { sendRecordingsToMac } from "@/mac-link/sender";
import { captureAnalytics } from "@/lib/analytics";
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

export type { RecorderPhase } from "@/audio/recorder-status";

export type RecorderFailure =
  | "permission_denied"
  | "notification_permission_denied"
  | "start_failed"
  | "media_services_reset"
  | "native_error"
  | "save_failed";

export type StopResult = "saved" | "failed" | "noop";

export function useSessionRecorder(
  sessionId: string,
  enabled: boolean,
): {
  phase: RecorderPhase;
  failure: RecorderFailure | null;
  amplitude: number;
  /** Recent levels (0 to 1), newest last, for the level strip. */
  levels: number[];
  /** Recorded time, without paused time. */
  durationMs: number;
  liveStatus: LiveTranscriptionStatus;
  liveTranscript: string;
  /** Pause and resume are available (Android). */
  canPause: boolean;
  start: () => Promise<void>;
  stop: () => Promise<StopResult>;
  pause: () => void;
  resume: () => Promise<void>;
  retry: () => Promise<StopResult>;
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
  const captureRegisteredRef = useRef(false);
  const stopRef = useRef<() => Promise<StopResult>>(async () => "noop");

  const registerCapture = useCallback(() => {
    if (captureRegisteredRef.current) return;
    captureRegisteredRef.current = true;
    beginMobileCapture(sessionId, () => stopRef.current());
  }, [sessionId]);

  const unregisterCapture = useCallback(() => {
    if (!captureRegisteredRef.current) return;
    captureRegisteredRef.current = false;
    endMobileCapture(sessionId);
  }, [sessionId]);

  const setPhase = useCallback(
    (next: RecorderPhase) => {
      phaseRef.current = next;
      setSessionRecording(sessionId, isCapturePhase(next));
      if (activeRef.current) setPhaseState(next);
    },
    [sessionId],
  );

  const reportFailure = useCallback(
    (reason: RecorderFailure, error: unknown, operation: string) => {
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
      }
      if (activeRef.current) setFailure(reason);
    },
    [],
  );

  const handleBuffer = useCallback(
    (buffer: AudioStreamBuffer) => {
      // Buffers can still arrive just after a pause; they were captured
      // before it. Native sends none while paused.
      if (!isCapturePhase(phaseRef.current)) return;
      const writer = writerRef.current;
      if (!writer) return;
      try {
        writer.append(buffer.data, buffer.sampleRate, buffer.channels);
      } catch (error) {
        reportFailure("save_failed", error, "recording_stream_write");
        setPhase("save_error");
        try {
          streamRef.current.stop();
        } catch {}
        void endMeetingRecordingActivity(sessionId).catch((activityError) => {
          captureOperationalError(activityError, {
            operation: "recording_live_activity_end",
          });
        });
        return;
      }
      const generation = startGenerationRef.current;
      liveRef.current ??= new SessionLiveTranscription(
        sessionId,
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
      durationRef.current = Math.round(writer.durationMs);
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
    },
    [reportFailure, sessionId, setPhase],
  );

  const { stream } = useAudioStream({
    sampleRate: STREAM_SAMPLE_RATE,
    channels: STREAM_CHANNELS,
    encoding: "int16",
    onBuffer: handleBuffer,
  });
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const performStart = useCallback(async () => {
    const generation = ++startGenerationRef.current;
    const isCurrent = () =>
      activeRef.current && generation === startGenerationRef.current;
    completionTrackedRef.current = false;
    durationRef.current = 0;
    levelsRef.current = [];
    setDurationMs(0);
    setAmplitude(0);
    setLevels([]);
    setLiveStatus("connecting");
    setLiveTranscript("");
    setFailure(null);
    reportedFailureRef.current = null;
    setPhase("starting");
    registerCapture();
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
        unregisterCapture();
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
          unregisterCapture();
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
      unregisterCapture();
      if (isRecordingStartCancelled(error)) {
        setPhase("idle");
        return;
      }
      reportFailure("start_failed", error, "recording_start");
      captureAnalytics("session_start_failed", {
        failure_stage: "capture_start",
      });
      setPhase("error");
    }
  }, [
    registerCapture,
    reportFailure,
    sessionId,
    setPhase,
    stream,
    unregisterCapture,
  ]);

  const start = useCallback((): Promise<void> => {
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
  }, [performStart]);

  useMountEffect(() => {
    activeRef.current = true;
    if (!enabled) return;
    void start();
  });

  useMountEffect(() => {
    // Also covers Pause, Resume and Stop & save in the notification, which
    // run while the app is in the background.
    const subscription = stream.addListener("audioStreamStatus", (status) => {
      const next = phaseAfterStreamStatus(phaseRef.current, status);
      if (next === "stop") void stopRef.current();
      else if (next) setPhase(next);
    });
    return () => subscription.remove();
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

  const performStop = async (): Promise<StopResult> => {
    await startRef.current?.catch(() => {});
    await resumeOperationRef.current?.catch(() => {});
    if (
      !["recording", "paused", "save_error", "error", "interrupted"].includes(
        phaseRef.current,
      )
    ) {
      return "noop";
    }
    if (!writerRef.current) {
      await endMeetingRecordingActivity(sessionId).catch((activityError) => {
        captureOperationalError(activityError, {
          operation: "recording_live_activity_end",
        });
      });
      return "noop";
    }
    setPhase("saving");
    try {
      streamRef.current.stop();
      await endMeetingRecordingActivity(sessionId).catch((activityError) => {
        captureOperationalError(activityError, {
          operation: "recording_live_activity_end",
        });
      });
      const writer = writerRef.current;
      if (!writer) throw new Error("Recording file is unavailable");
      const live = liveRef.current;
      writer.finalize();
      await catalogSessionAudio(sessionId, {
        source: "recording",
        filename: "audio.wav",
        contentType: "audio/wav",
      });
      const liveComplete = await (live?.stop() ?? Promise.resolve(false));
      // The Mac transcribes and summarizes every recording. A live transcript
      // (only with the user's own cloud key) stays on the phone as a preview.
      const transcriptionMode = liveComplete ? "live" : "mac";
      if (liveComplete) {
        await markSessionAudioTranscribed(sessionId)
          .then(() => {
            generateSummaryAfterTranscription(sessionId);
          })
          .catch((error) => {
            captureOperationalError(error, {
              operation: "transcription_live_mark_complete",
              tags: { mode: "live" },
            });
          });
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
      writerRef.current = null;
      liveRef.current = null;
      unregisterCapture();
      setFailure(null);
      setPhase("saved");
      return "saved";
    } catch (error) {
      reportFailure("save_failed", error, "recording_save");
      setPhase("save_error");
      return "failed";
    }
  };

  const stop = (): Promise<StopResult> => {
    const currentOperation = stopOperationRef.current;
    if (currentOperation) return currentOperation;
    const operation = performStop();
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
      if (streamRef.current.pause?.()) setPhase("paused");
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
        setPhase("recording");
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

  const setNotificationTitle = useCallback((title: string) => {
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
  }, []);

  const retry = async (): Promise<StopResult> => {
    if (
      writerRef.current &&
      ["save_error", "interrupted", "error"].includes(phaseRef.current)
    ) {
      return stop();
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
      unregisterCapture();
      // A start cut short by leaving the screen never reaches a later phase.
      setSessionRecording(sessionId, false);
    };
    void stopRef.current().then(release, release);
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
    start,
    stop,
    pause,
    resume,
    retry,
    setNotificationTitle,
  };
}
