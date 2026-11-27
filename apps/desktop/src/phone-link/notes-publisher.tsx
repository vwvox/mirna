import {
  commands as phoneLinkCommands,
  events as phoneLinkEvents,
  type LinkedNote,
  type PublishedNote,
} from "@anlg/plugin-phone-link";
import { useMountEffect } from "@anlg/ui/hooks/use-mount-effect";

import { liveQueryClient } from "~/db";
import {
  countPhoneReviews,
  lessonForPhone,
  publishCourses,
} from "~/phone-link/lessons";
import { loadSessionContentSnapshot } from "~/session/content-queries";

// Phones download the text of the notes their recordings became: title,
// summary and transcripts, never the audio. This hands the phone-link plugin
// fresh copies when a phone asks and after a recording is processed. The
// plugin keeps only notes whose text changed, so phones download little.
export function PhoneNotesPublisher() {
  useMountEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void phoneLinkEvents.phoneLinkEvent
      .listen((event) => {
        if (event.payload.type === "notesRequested") {
          void publishLinkedNotes({
            includeMacNotes: event.payload.include_mac_notes,
          });
        } else if (event.payload.type === "reviewsReceived") {
          void countReviewsAndPublish();
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    // Reviews a phone sent while this app was closed.
    void countReviewsAndPublish();
    return () => {
      cancelled = true;
      stop?.();
    };
  });
  return null;
}

/** Reviews played on a phone count like ones played here; then the phones hear. */
async function countReviewsAndPublish() {
  try {
    if (await countPhoneReviews()) {
      publishedMarkers.clear();
    }
  } catch (error) {
    console.error("[phone-link] could not count phone reviews", error);
  }
  void publishLinkedNotes();
}

// What each note looked like when it was last published, so unchanged notes
// aren't read again.
const publishedMarkers = new Map<string, string>();
let publishing: Promise<void> | null = null;
let again: { includeMacNotes: boolean } | null = null;

// The most recent notes recorded on this Mac that phones can ask for.
const MAC_NOTES_LIMIT = 200;

export function publishLinkedNotes(
  options: { includeMacNotes?: boolean } = {},
): Promise<void> {
  const includeMacNotes = options.includeMacNotes ?? false;
  if (publishing) {
    again = {
      includeMacNotes: includeMacNotes || (again?.includeMacNotes ?? false),
    };
    return publishing;
  }
  publishing = publish(includeMacNotes)
    .catch((error: unknown) => {
      console.error("[phone-link] could not publish notes", error);
    })
    .finally(() => {
      publishing = null;
      if (again) {
        const next = again;
        again = null;
        void publishLinkedNotes(next);
      }
    });
  return publishing;
}

type Target = LinkedNote | { recording_id: null; session_id: string };

async function publish(includeMacNotes: boolean) {
  const linked = await phoneLinkCommands.listLinkedNotes();
  if (linked.status === "error") throw new Error(linked.error);

  const targets: Target[] = [...linked.data];
  const linkedIds = new Set(linked.data.map((link) => link.session_id));
  // Lessons always go: reviewing on the phone is the point of them.
  const macIds = includeMacNotes ? await macNoteIds() : await macLessonIds();
  for (const sessionId of macIds) {
    if (!linkedIds.has(sessionId)) {
      linkedIds.add(sessionId);
      targets.push({ recording_id: null, session_id: sessionId });
    }
  }
  try {
    await publishCourses();
  } catch (error) {
    console.error("[phone-link] could not publish courses", error);
  }

  const markers = await changeMarkers(
    targets.map((target) => target.session_id),
  );
  const notes: PublishedNote[] = [];
  const nextMarkers = new Map<string, string>();
  for (const target of targets) {
    const marker = markers.get(target.session_id);
    if (!marker || publishedMarkers.get(target.session_id) === marker) continue;
    const note = await noteFor(target);
    if (!note) continue;
    notes.push(note);
    nextMarkers.set(target.session_id, marker);
  }

  // Publish even when nothing changed: a phone may be waiting for the answer.
  const result = await phoneLinkCommands.publishNotes(notes);
  if (result.status === "error") throw new Error(result.error);
  for (const [sessionId, marker] of nextMarkers) {
    publishedMarkers.set(sessionId, marker);
  }
}

/** A cheap fingerprint of each note's title, summaries and transcripts. */
async function changeMarkers(sessionIds: string[]) {
  const markers = new Map<string, string>();
  for (let start = 0; start < sessionIds.length; start += 200) {
    const ids = sessionIds.slice(start, start + 200);
    const rows = await liveQueryClient.execute<{ id: string; marker: string }>(
      `SELECT session.id,
        session.title || '|' || session.updated_at || '|' ||
        COALESCE((SELECT MAX(document.updated_at) || ':' || COUNT(*)
          FROM session_documents AS document
          WHERE document.session_id = session.id
            AND document.kind IN ('summary', 'template_output', 'lesson_sheet',
              'lesson_review', 'lesson_practice')
            AND document.deleted_at IS NULL), '') || '|' ||
        COALESCE(session.kind, '') || '|' || COALESCE(session.folder_path, '') || '|' ||
        COALESCE((SELECT MAX(transcript.updated_at) || ':' || COUNT(*)
          FROM transcripts AS transcript
          WHERE transcript.session_id = session.id
            AND transcript.deleted_at IS NULL), '') AS marker
      FROM sessions AS session
      WHERE session.deleted_at IS NULL
        AND session.id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    for (const row of rows) markers.set(row.id, row.marker);
  }
  return markers;
}

/** Lessons recorded on this Mac, newest first. */
async function macLessonIds(): Promise<string[]> {
  const rows = await liveQueryClient.execute<{ id: string }>(
    `SELECT id FROM sessions
    WHERE deleted_at IS NULL AND kind = 'lesson'
    ORDER BY created_at DESC
    LIMIT ${MAC_NOTES_LIMIT}`,
    [],
  );
  return rows.map((row) => row.id);
}

/** Notes recorded on this Mac that have a summary or a transcript, newest first. */
async function macNoteIds(): Promise<string[]> {
  const rows = await liveQueryClient.execute<{ id: string }>(
    `SELECT session.id FROM sessions AS session
    WHERE session.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM session_documents AS document
          WHERE document.session_id = session.id
            AND document.kind IN ('summary', 'template_output')
            AND document.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM transcripts AS transcript
          WHERE transcript.session_id = session.id
            AND transcript.deleted_at IS NULL)
      )
    ORDER BY session.created_at DESC
    LIMIT ${MAC_NOTES_LIMIT}`,
    [],
  );
  return rows.map((row) => row.id);
}

async function noteFor(target: Target): Promise<PublishedNote | null> {
  const snapshot = await loadSessionContentSnapshot(target.session_id);
  if (!snapshot) return null;
  const summary = snapshot.enhancedNotes
    .slice()
    .sort((a, b) => a.position - b.position)
    .find((note) => note.markdown.trim());
  let lesson: PublishedNote["lesson"] = null;
  try {
    lesson = await lessonForPhone(target.session_id);
  } catch (error) {
    console.error("[phone-link] could not get the lesson ready", error);
  }
  return {
    recording_id: target.recording_id,
    session_id: target.session_id,
    created_at: target.recording_id ? null : snapshot.createdAt,
    lesson,
    title: snapshot.title.trim(),
    summary_md: summary?.markdown.trim() || null,
    transcripts: snapshot.transcripts
      .slice()
      .sort((a, b) => a.started_at - b.started_at)
      .map((transcript) => ({
        id: transcript.id,
        started_at_ms: transcript.started_at,
        ended_at_ms: transcript.ended_at,
        memo: transcript.memo,
        words_json: transcript.wordsJson,
        speaker_hints_json: transcript.speakerHintsJson,
      })),
  };
}
