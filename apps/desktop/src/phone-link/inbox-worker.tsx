import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { md2json } from "@anlg/editor/markdown";
import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import {
  commands as phoneLinkCommands,
  events as phoneLinkEvents,
  type InboxEntry,
  type RecordingUpdate,
} from "@anlg/plugin-phone-link";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { liveQueryClient } from "~/db";
import { publishLinkedNotes } from "~/phone-link/notes-publisher";
import { getEnhancerService } from "~/services/enhancer";
import { catalogLocalSessionAudio } from "~/session/attachments";
import { enqueueSessionAudioOperation } from "~/session/audio-operations";
import { loadSessionContentSnapshot } from "~/session/content-queries";
import { createSession } from "~/session/queries/creation";
import { updateSession, useSession } from "~/session/queries";
import { useAiProvidersState } from "~/settings/providers";
import { useSettingsReady } from "~/settings/queries";
import { DEFAULT_USER_ID } from "~/shared/utils";
import { useListener } from "~/stt/contexts";
import { isStoppedTranscriptionError, useRunBatch } from "~/stt/useRunBatch";

export const PHONE_INBOX_QUERY_KEY = ["phone-link", "inbox"] as const;

// Recordings the phone sent are processed one at a time, like a dropped audio
// file: a note dated when the phone started recording, the audio imported,
// transcribed on this Mac, then summarized. Progress is reported back to the
// phone through the phone-link plugin.
export function PhoneInboxWorker() {
  const queryClient = useQueryClient();
  const liveBusy = useListener(
    (state) =>
      state.live.status === "active" || state.live.status === "finalizing",
  );

  useMountEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void phoneLinkEvents.phoneLinkEvent
      .listen((event) => {
        if (event.payload.type === "recordingReceived") {
          void queryClient.invalidateQueries({
            queryKey: PHONE_INBOX_QUERY_KEY,
          });
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  });

  const { data: items = [] } = useQuery({
    queryKey: PHONE_INBOX_QUERY_KEY,
    queryFn: async () => {
      const result = await phoneLinkCommands.listInbox();
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  // A meeting being recorded on this Mac comes first; phone recordings wait.
  const next = items[0];
  if (!next || liveBusy) return null;
  return <PhoneRecordingJob key={next.id} item={next} />;
}

const sessionsByRecording = new Map<string, string>();
const runningRecordings = new Set<string>();

function PhoneRecordingJob({ item }: { item: InboxEntry }) {
  const [sessionId, setSessionId] = useState(() =>
    sessionsByRecording.get(item.id),
  );

  useMountEffect(() => {
    if (sessionId) return;
    let cancelled = false;
    void ensureSession(item)
      .then((id) => {
        sessionsByRecording.set(item.id, id);
        if (!cancelled) setSessionId(id);
      })
      .catch((error: unknown) => {
        console.error("[phone-link] could not create the note", error);
        void reportUpdate(item.id, {
          type: "failed",
          error: "Mirna on your Mac could not create the note.",
          session_id: null,
        });
      });
    return () => {
      cancelled = true;
    };
  });

  return sessionId ? (
    <ReadyPhoneRecording item={item} sessionId={sessionId} />
  ) : null;
}

function ReadyPhoneRecording({
  item,
  sessionId,
}: {
  item: InboxEntry;
  sessionId: string;
}) {
  const session = useSession(sessionId);
  const settingsReady = useSettingsReady();
  const stt = useAiProvidersState("stt");
  const llm = useAiProvidersState("llm");
  return session && settingsReady && stt.isReady && llm.isReady ? (
    <RunPhoneRecording item={item} sessionId={sessionId} />
  ) : null;
}

function RunPhoneRecording({
  item,
  sessionId,
}: {
  item: InboxEntry;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const runBatch = useRunBatch(sessionId);

  useMountEffect(() => {
    // Defer until after React's mount/cleanup probe. Once started, the work
    // outlives this component so navigation doesn't interrupt it.
    const start = setTimeout(() => {
      if (runningRecordings.has(item.id)) return;
      runningRecordings.add(item.id);
      void processRecording(item, sessionId, runBatch)
        .catch((error: unknown) => {
          console.error("[phone-link] processing failed", error);
        })
        .finally(() => {
          runningRecordings.delete(item.id);
          sessionsByRecording.delete(item.id);
          void queryClient.invalidateQueries({
            queryKey: PHONE_INBOX_QUERY_KEY,
          });
        });
    }, 0);
    return () => clearTimeout(start);
  });

  return null;
}

async function ensureSession(item: InboxEntry): Promise<string> {
  if (item.session_id) {
    const rows = await liveQueryClient.execute<{ id: string }>(
      `SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [item.session_id],
    );
    if (rows.length > 0) return item.session_id;
  }

  const notes = item.notes_md?.trim();
  const sessionId = await createSession(item.title?.trim() ?? "", DEFAULT_USER_ID, {
    raw_md: notes ? JSON.stringify(md2json(notes)) : "",
  });
  const startedAt = item.started_at ? new Date(item.started_at) : null;
  if (startedAt && !Number.isNaN(startedAt.getTime())) {
    await updateSession(sessionId, { created_at: startedAt.toISOString() });
  }
  await reportUpdate(item.id, {
    type: "processing",
    stage: "importing",
    session_id: sessionId,
  });
  return sessionId;
}

async function processRecording(
  item: InboxEntry,
  sessionId: string,
  runBatch: ReturnType<typeof useRunBatch>,
) {
  let stage = "importing";
  const setStage = async (next: string) => {
    stage = next;
    await reportUpdate(item.id, {
      type: "processing",
      stage: next,
      session_id: sessionId,
    });
  };

  try {
    await setStage("importing");
    const importedPath = await enqueueSessionAudioOperation(
      sessionId,
      async () => {
        const result = await fsSyncCommands.audioImport(
          sessionId,
          item.audio_path,
        );
        if (result.status === "error") throw new Error(result.error);
        try {
          await catalogLocalSessionAudio(sessionId);
        } catch (error) {
          console.error("[phone-link] could not catalog the audio", error);
        }
        return result.data;
      },
    );

    await setStage("transcribing");
    await runBatch(importedPath, {
      promotion: { scope: "whole_session" },
      // Dated when the phone recorded it, so the phone can tell its own
      // recording from ones added to the note later on this Mac.
      captureInterval: captureIntervalOf(item),
    });

    await setStage("summarizing");
    const enhancer = getEnhancerService();
    if (enhancer) {
      try {
        await enhancer.enhanceAndWait(sessionId);
      } catch (error) {
        // The transcript is safe; the summary can be made again on the Mac.
        console.error("[phone-link] summary failed", error);
      }
    }

    const { title, summary } = await readNote(sessionId);
    await reportUpdate(item.id, {
      type: "done",
      session_id: sessionId,
      title,
      summary_md: summary,
    });
    void publishLinkedNotes();
  } catch (error) {
    if (!isStoppedTranscriptionError(error)) {
      console.error(`[phone-link] ${stage} failed`, error);
    }
    await reportUpdate(item.id, {
      type: "failed",
      error: isStoppedTranscriptionError(error)
        ? "Transcription was stopped on the Mac."
        : stage === "importing"
          ? "The Mac could not read this recording."
          : "The Mac could not transcribe this recording. Open the note on your Mac to try again.",
      session_id: sessionId,
    });
  }
}

function captureIntervalOf(item: InboxEntry) {
  const startedAtMs = item.started_at ? Date.parse(item.started_at) : NaN;
  const durationMs = item.duration_ms ?? NaN;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(durationMs)) {
    return undefined;
  }
  return { startedAtMs, stoppedAtMs: startedAtMs + durationMs };
}

// The title is written just after the summary, so give it a moment.
async function readNote(sessionId: string) {
  let title: string | null = null;
  let summary: string | null = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const snapshot = await loadSessionContentSnapshot(sessionId);
    const note = snapshot?.enhancedNotes
      .slice()
      .sort((a, b) => a.position - b.position)
      .find((candidate) => candidate.markdown.trim());
    title = snapshot?.title.trim() || null;
    summary = note?.markdown.trim() || null;
    if (title) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { title, summary };
}

async function reportUpdate(id: string, update: RecordingUpdate) {
  const result = await phoneLinkCommands.updateRecording(id, update);
  if (result.status === "error") {
    console.error("[phone-link] could not record progress", result.error);
  }
}
