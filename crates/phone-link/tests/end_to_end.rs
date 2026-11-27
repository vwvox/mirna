#![cfg(all(feature = "client", feature = "server"))]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use phone_link::client::{Client, MacTarget};
use phone_link::protocol::{
    CompleteRequest, NoteJob, NoteSnapshot, NoteTranscript, RecordingMeta, RecordingState,
};
use phone_link::server::{PhoneLinkServer, ServerEvent, StatusUpdate};
use phone_link::{Error, Identity};
use sha2::{Digest, Sha256};

struct Mac {
    server: PhoneLinkServer,
    port: u16,
    events: Arc<Mutex<Vec<ServerEvent>>>,
    _dir: tempfile::TempDir,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

async fn start_mac() -> Mac {
    let dir = tempfile::tempdir().unwrap();
    let server = PhoneLinkServer::open(dir.path(), "Test Mac").unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    server.set_event_sink(move |event| sink.lock().unwrap().push(event));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let serving = server.clone();
    tokio::spawn(async move {
        serving
            .serve(listener, async {
                let _ = rx.await;
            })
            .await;
    });
    Mac {
        server,
        port,
        events,
        _dir: dir,
        _shutdown: tx,
    }
}

fn client_for(mac: &Mac, identity: &Identity, fingerprint: &str) -> Client {
    Client::new(
        identity,
        MacTarget {
            // The first address is unreachable on purpose: the client must
            // move on to the next one.
            hosts: vec!["127.0.0.2".into(), "127.0.0.1".into()],
            port: mac.port,
            fingerprint: fingerprint.into(),
        },
    )
    .unwrap()
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

#[tokio::test]
async fn pairs_uploads_and_reports_progress() {
    let mac = start_mac().await;
    let phone = Identity::generate().unwrap();
    let offer =
        mac.server
            .begin_pairing(vec!["127.0.0.1".into()], mac.port, Duration::from_secs(60));
    let offer = phone_link::PairingOffer::parse(&offer.to_uri()).unwrap();
    let client = client_for(&mac, &phone, &offer.fingerprint);

    let info = client.info().await.unwrap();
    assert!(!info.paired);
    assert_eq!(info.mac_name, "Test Mac");

    // Unpaired phones can't touch recordings.
    assert!(matches!(
        client.status("0b5a4c1e-0000-4000-8000-000000000001").await,
        Err(Error::NotPaired)
    ));

    let paired = client.pair(&offer.code, "Pixel test").await.unwrap();
    assert_eq!(paired.mac_id, offer.mac_id);
    assert!(client.info().await.unwrap().paired);
    assert_eq!(mac.server.paired_phones()[0].name, "Pixel test");
    assert_eq!(client.working_host().as_deref(), Some("127.0.0.1"));

    // The code works once.
    let other = Identity::generate().unwrap();
    let other_client = client_for(&mac, &other, &offer.fingerprint);
    assert!(matches!(
        other_client.pair(&offer.code, "Intruder").await,
        Err(Error::PairingRejected)
    ));

    // Upload in three chunks, with a resume after a wrong offset.
    let id = "0b5a4c1e-0000-4000-8000-000000000001";
    let audio: Vec<u8> = (0..250_000u32).map(|i| (i % 251) as u8).collect();
    assert_eq!(
        client
            .upload_chunk(id, 0, Bytes::copy_from_slice(&audio[..100_000]))
            .await
            .unwrap(),
        100_000
    );
    match client
        .upload_chunk(id, 5, Bytes::copy_from_slice(&audio[5..10]))
        .await
    {
        Err(Error::OffsetMismatch { received_bytes }) => assert_eq!(received_bytes, 100_000),
        other => panic!("expected offset mismatch, got {other:?}"),
    }
    let status = client.status(id).await.unwrap();
    assert_eq!(status.state, RecordingState::Receiving);
    assert_eq!(status.received_bytes, 100_000);
    client
        .upload_chunk(
            id,
            100_000,
            Bytes::copy_from_slice(&audio[100_000..200_000]),
        )
        .await
        .unwrap();
    client
        .upload_chunk(id, 200_000, Bytes::copy_from_slice(&audio[200_000..]))
        .await
        .unwrap();

    // Another paired phone can't see or change this recording.
    let offer2 =
        mac.server
            .begin_pairing(vec!["127.0.0.1".into()], mac.port, Duration::from_secs(60));
    other_client
        .pair(&offer2.code, "Second phone")
        .await
        .unwrap();
    assert_eq!(
        other_client.status(id).await.unwrap().state,
        RecordingState::Missing
    );

    // A wrong checksum is refused.
    let bad = CompleteRequest {
        size: audio.len() as u64,
        sha256: "0".repeat(64),
        meta: RecordingMeta {
            ext: "wav".into(),
            ..Default::default()
        },
    };
    assert!(matches!(
        client.complete(id, &bad).await,
        Err(Error::Http { status: 422, .. })
    ));
    // ...and the damaged upload is dropped, so it starts over.
    assert_eq!(
        client.status(id).await.unwrap().state,
        RecordingState::Missing
    );
    for (start, end) in [(0, 125_000), (125_000, audio.len())] {
        client
            .upload_chunk(id, start as u64, Bytes::copy_from_slice(&audio[start..end]))
            .await
            .unwrap();
    }

    let done = client
        .complete(
            id,
            &CompleteRequest {
                size: audio.len() as u64,
                sha256: sha256_hex(&audio),
                meta: RecordingMeta {
                    title: Some("Standup".into()),
                    started_at: Some("2026-11-22T09:30:00Z".into()),
                    duration_ms: Some(7_800),
                    ext: "wav".into(),
                    notes_md: Some("- ask about budget".into()),
                    lesson: None,
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(done.state, RecordingState::Queued);
    assert!(mac.events.lock().unwrap().iter().any(
        |event| matches!(event, ServerEvent::RecordingReceived { id: received } if received == id)
    ));

    // Sending again is harmless.
    assert!(matches!(
        client.upload_chunk(id, 0, Bytes::from_static(b"x")).await,
        Err(Error::AlreadyReceived)
    ));

    // The Mac processes it.
    let inbox = mac.server.inbox().unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].meta.title.as_deref(), Some("Standup"));
    assert_eq!(inbox[0].phone_name, "Pixel test");
    assert_eq!(std::fs::read(&inbox[0].audio_path).unwrap(), audio);

    mac.server
        .update_status(
            id,
            StatusUpdate::Processing {
                stage: "transcribing".into(),
                session_id: Some("session-1".into()),
            },
        )
        .await
        .unwrap();
    let status = client.statuses(&[id.to_string()]).await.unwrap();
    assert_eq!(status[0].state, RecordingState::Processing);
    assert_eq!(status[0].stage.as_deref(), Some("transcribing"));

    mac.server
        .update_status(
            id,
            StatusUpdate::Done {
                session_id: "session-1".into(),
                title: Some("Standup with Ana".into()),
                summary_md: Some("# Standup\n- Budget approved".into()),
            },
        )
        .await
        .unwrap();
    let status = client.status(id).await.unwrap();
    assert_eq!(status.state, RecordingState::Done);
    assert_eq!(status.title.as_deref(), Some("Standup with Ana"));
    assert!(mac.server.inbox().unwrap().is_empty());
    assert!(
        !inbox[0].audio_path.exists(),
        "inbox copy removed after import"
    );

    // The note's text flows back to the phone that sent the recording.
    mac.server.set_notes_refresh_wait(Duration::ZERO);
    assert_eq!(
        mac.server.linked_notes().unwrap(),
        vec![(id.to_string(), "session-1".to_string())]
    );
    let note = NoteSnapshot {
        recording_id: Some(id.into()),
        created_at: None,
        lesson: None,
        session_id: "session-1".into(),
        title: "Standup with Ana".into(),
        summary_md: Some("# Standup\n- Budget approved".into()),
        transcripts: vec![NoteTranscript {
            id: "transcript-1".into(),
            started_at_ms: 1_795_000_000_000,
            ended_at_ms: Some(1_795_000_007_800),
            memo: String::new(),
            words_json: "[]".into(),
            speaker_hints_json: "[]".into(),
        }],
    };
    assert_eq!(mac.server.publish_notes(vec![note.clone()]).unwrap(), 1);
    // The same text again changes nothing.
    assert_eq!(mac.server.publish_notes(vec![note.clone()]).unwrap(), 0);
    // A note for a recording no phone sent is ignored.
    let stranger = NoteSnapshot {
        recording_id: Some("0b5a4c1e-0000-4000-8000-00000000ffff".into()),
        ..note.clone()
    };
    assert_eq!(mac.server.publish_notes(vec![stranger]).unwrap(), 0);

    let changes = client.note_changes(0, false).await.unwrap();
    assert_eq!(changes.notes, vec![note.clone()]);
    assert!(!changes.more);
    assert!(
        mac.events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, ServerEvent::NotesRequested { .. }))
    );
    assert!(
        client
            .note_changes(changes.cursor, false)
            .await
            .unwrap()
            .notes
            .is_empty()
    );
    // Another phone never sees it.
    assert!(
        other_client
            .note_changes(0, false)
            .await
            .unwrap()
            .notes
            .is_empty()
    );

    // Notes recorded on the Mac go only to phones that ask for them.
    let mac_note = NoteSnapshot {
        recording_id: None,
        session_id: "mac-session".into(),
        title: "Zoom with the team".into(),
        created_at: Some("2026-11-22T15:00:00Z".into()),
        lesson: None,
        summary_md: Some("- Shipping next week".into()),
        transcripts: Vec::new(),
    };
    assert_eq!(mac.server.publish_notes(vec![mac_note.clone()]).unwrap(), 1);
    assert!(
        client
            .note_changes(changes.cursor, false)
            .await
            .unwrap()
            .notes
            .is_empty()
    );
    let with_mac = other_client.note_changes(0, true).await.unwrap();
    assert_eq!(with_mac.notes, vec![mac_note]);

    // Only a recording the Mac failed on can be retried.
    assert!(matches!(
        client.retry(id).await,
        Err(Error::Http { status: 409, .. })
    ));

    // A recording added to the note on the Mac changes it again.
    let mut updated = note.clone();
    updated.transcripts.push(NoteTranscript {
        id: "transcript-2".into(),
        started_at_ms: 1_795_000_900_000,
        ended_at_ms: Some(1_795_001_000_000),
        ..note.transcripts[0].clone()
    });
    assert_eq!(mac.server.publish_notes(vec![updated.clone()]).unwrap(), 1);
    let next = client.note_changes(changes.cursor, false).await.unwrap();
    assert_eq!(next.notes, vec![updated]);
}

#[tokio::test]
async fn refuses_a_different_mac() {
    let mac = start_mac().await;
    let impostor = start_mac().await;
    let phone = Identity::generate().unwrap();
    let client = Client::new(
        &phone,
        MacTarget {
            hosts: vec!["127.0.0.1".into()],
            port: impostor.port,
            fingerprint: mac.server.fingerprint(),
        },
    )
    .unwrap();
    assert!(matches!(client.info().await, Err(Error::MacMismatch)));
}

#[tokio::test]
async fn expired_code_is_refused_and_removed_phone_loses_access() {
    let mac = start_mac().await;
    let phone = Identity::generate().unwrap();
    let offer =
        mac.server
            .begin_pairing(vec!["127.0.0.1".into()], mac.port, Duration::from_millis(1));
    tokio::time::sleep(Duration::from_millis(20)).await;
    let client = client_for(&mac, &phone, &offer.fingerprint);
    assert!(matches!(
        client.pair(&offer.code, "Late").await,
        Err(Error::PairingRejected)
    ));

    let offer =
        mac.server
            .begin_pairing(vec!["127.0.0.1".into()], mac.port, Duration::from_secs(60));
    client.pair(&offer.code, "On time").await.unwrap();
    assert!(client.info().await.unwrap().paired);
    assert!(
        mac.server
            .remove_phone(&phone.fingerprint().unwrap())
            .unwrap()
    );
    assert!(!client.info().await.unwrap().paired);
    assert!(matches!(
        client
            .statuses(&["0b5a4c1e-0000-4000-8000-000000000002".into()])
            .await,
        Err(Error::NotPaired)
    ));
}

#[tokio::test]
async fn identity_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let first = PhoneLinkServer::open(dir.path(), "Mac")
        .unwrap()
        .fingerprint();
    let second = PhoneLinkServer::open(dir.path(), "Mac")
        .unwrap()
        .fingerprint();
    assert_eq!(first, second);
}

/// A 16 kHz mono 16-bit WAV of `ms` milliseconds.
fn wav(ms: u64) -> Vec<u8> {
    let data_bytes = (ms * 32) as u32;
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&16_000u32.to_le_bytes());
    out.extend_from_slice(&32_000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    out.extend((0..data_bytes).map(|i| (i % 7) as u8));
    out
}

async fn paired_phone(mac: &Mac, name: &str) -> Client {
    let identity = Identity::generate().unwrap();
    let offer =
        mac.server
            .begin_pairing(vec!["127.0.0.1".into()], mac.port, Duration::from_secs(60));
    let client = client_for(mac, &identity, &offer.fingerprint);
    client.pair(&offer.code, name).await.unwrap();
    client
}

async fn send_recording(client: &Client, id: &str, audio: &[u8]) {
    client
        .upload_chunk(id, 0, Bytes::copy_from_slice(audio))
        .await
        .unwrap();
    client
        .complete(
            id,
            &CompleteRequest {
                size: audio.len() as u64,
                sha256: sha256_hex(audio),
                meta: RecordingMeta {
                    ext: "wav".into(),
                    duration_ms: Some(10_000),
                    ..Default::default()
                },
            },
        )
        .await
        .unwrap();
}

fn conflict(result: Result<phone_link::protocol::RecordingStatus, Error>) -> String {
    match result {
        Err(Error::Http { status, message }) => format!("{status} {message}"),
        other => panic!("expected an HTTP error, got {other:?}"),
    }
}

#[test]
fn trims_a_wav_in_place_even_when_its_header_undercounts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audio.wav");
    let mut audio = wav(10_000);
    // A header checkpointed mid-recording says only 1 s of data.
    audio[40..44].copy_from_slice(&32_000u32.to_le_bytes());
    std::fs::write(&path, &audio).unwrap();

    let trimmed = phone_link::trim_wav_file(&path, 4_000).unwrap();
    assert_eq!(trimmed.duration_ms, 4_000);
    assert_eq!(trimmed.data_bytes, 128_000);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes.len(), 44 + 128_000);
    assert_eq!(
        u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
        128_000
    );
    assert_eq!(
        u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        36 + 128_000
    );
    assert_eq!(&bytes[44..44 + 100], &audio[44..44 + 100]);

    // Keeping more than there is changes nothing but the header.
    let again = phone_link::trim_wav_file(&path, 60_000).unwrap();
    assert_eq!(again.duration_ms, 4_000);

    std::fs::write(&path, b"not a wav at all").unwrap();
    assert!(phone_link::trim_wav_file(&path, 1_000).is_err());
}

#[tokio::test]
async fn a_longer_recording_replaces_the_one_the_mac_made_a_note_of() {
    let mac = start_mac().await;
    let client = paired_phone(&mac, "Phone A").await;
    let id = "0b5a4c1e-0000-4000-8000-0000000000cc";
    let extend = NoteJob::Extend {
        update_summary: true,
    };

    // The Mac has nothing yet: there's nothing to drop, the phone just sends.
    let status = client.note_job(id, &extend).await.unwrap();
    assert_eq!(status.state, RecordingState::Missing);
    assert_eq!(status.job, None);

    send_recording(&client, id, &wav(2_000)).await;
    mac.server
        .update_status(
            id,
            StatusUpdate::Processing {
                stage: "transcribing".into(),
                session_id: Some("session-1".into()),
            },
        )
        .await
        .unwrap();
    assert_eq!(conflict(client.note_job(id, &extend).await), "409 busy");
    mac.server
        .update_status(
            id,
            StatusUpdate::Done {
                session_id: "session-1".into(),
                title: Some("Standup".into()),
                summary_md: None,
            },
        )
        .await
        .unwrap();

    // More was recorded on the phone: the Mac waits for the longer file and
    // keeps its note. Asking twice changes nothing.
    let status = client.note_job(id, &extend).await.unwrap();
    assert_eq!(status.state, RecordingState::Missing);
    assert_eq!(status.session_id.as_deref(), Some("session-1"));
    assert_eq!(status.job, Some(extend.clone()));
    let again = client.note_job(id, &extend).await.unwrap();
    assert_eq!(again.job, Some(extend.clone()));
    assert!(mac.server.inbox().unwrap().is_empty());

    // It arrives in pieces, like any recording, then goes back to that note.
    let longer = wav(5_000);
    let (first, rest) = longer.split_at(1_000);
    client
        .upload_chunk(id, 0, Bytes::copy_from_slice(first))
        .await
        .unwrap();
    let status = client.status(id).await.unwrap();
    assert_eq!(status.state, RecordingState::Receiving);
    assert_eq!(status.received_bytes, 1_000);
    assert_eq!(status.session_id.as_deref(), Some("session-1"));
    client
        .upload_chunk(id, 1_000, Bytes::copy_from_slice(rest))
        .await
        .unwrap();
    let status = client
        .complete(
            id,
            &CompleteRequest {
                size: longer.len() as u64,
                sha256: sha256_hex(&longer),
                meta: RecordingMeta {
                    ext: "wav".into(),
                    duration_ms: Some(5_000),
                    ..Default::default()
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(status.state, RecordingState::Queued);
    assert_eq!(status.session_id.as_deref(), Some("session-1"));
    assert_eq!(status.job, Some(extend.clone()));
    let item = mac.server.inbox().unwrap().remove(0);
    assert_eq!(item.job, Some(extend.clone()));
    assert_eq!(item.status.session_id.as_deref(), Some("session-1"));
    assert_eq!(std::fs::read(&item.audio_path).unwrap(), longer);

    // A shorter copy still waiting (never a note) is simply dropped.
    let waiting = "0b5a4c1e-0000-4000-8000-0000000000dd";
    send_recording(&client, waiting, &wav(1_000)).await;
    let status = client.note_job(waiting, &extend).await.unwrap();
    assert_eq!(status.state, RecordingState::Missing);
    assert_eq!(status.job, None);
    assert!(
        mac.server
            .inbox()
            .unwrap()
            .iter()
            .all(|item| item.id != waiting)
    );
}

#[tokio::test]
async fn phone_asks_for_note_jobs_and_sends_its_log() {
    let mac = start_mac().await;
    let client = paired_phone(&mac, "Phone A").await;
    let id = "0b5a4c1e-0000-4000-8000-0000000000aa";
    send_recording(&client, id, &wav(10_000)).await;

    // Not a note yet: a trim cuts the waiting file and its metadata.
    let status = client
        .note_job(
            id,
            &NoteJob::Trim {
                keep_ms: 4_000,
                update_summary: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(status.state, RecordingState::Queued);
    assert_eq!(status.job, None);
    let item = mac.server.inbox().unwrap().remove(0);
    assert_eq!(item.meta.duration_ms, Some(4_000));
    assert_eq!(
        std::fs::metadata(&item.audio_path).unwrap().len(),
        44 + 128_000
    );

    // It will be transcribed anyway, so asking again changes nothing.
    let retranscribe = NoteJob::Retranscribe {
        engine: "qwen3".into(),
        update_summary: true,
    };
    let status = client.note_job(id, &retranscribe).await.unwrap();
    assert_eq!(status.job, None);

    // Nonsense and other phones are refused.
    let bad = NoteJob::Retranscribe {
        engine: "whisper".into(),
        update_summary: false,
    };
    assert_eq!(conflict(client.note_job(id, &bad).await), "400 invalid_job");
    let other = paired_phone(&mac, "Phone B").await;
    assert_eq!(
        conflict(other.note_job(id, &retranscribe).await),
        "403 not_yours"
    );

    // While the Mac works on it, the phone has to wait.
    mac.server
        .update_status(
            id,
            StatusUpdate::Processing {
                stage: "transcribing".into(),
                session_id: Some("session-1".into()),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        conflict(client.note_job(id, &retranscribe).await),
        "409 busy"
    );

    // Once it's a note, the job is queued even though the inbox copy is gone.
    mac.server
        .update_status(
            id,
            StatusUpdate::Done {
                session_id: "session-1".into(),
                title: None,
                summary_md: None,
            },
        )
        .await
        .unwrap();
    let status = client.note_job(id, &retranscribe).await.unwrap();
    assert_eq!(status.state, RecordingState::Queued);
    assert_eq!(status.job, Some(retranscribe.clone()));
    let item = mac.server.inbox().unwrap().remove(0);
    assert_eq!(item.job, Some(retranscribe.clone()));
    assert!(!item.audio_path.exists());
    assert_eq!(
        conflict(client.note_job(id, &retranscribe).await),
        "409 busy"
    );

    // A failed job can be tried again; finishing clears it.
    mac.server
        .update_status(
            id,
            StatusUpdate::Failed {
                error: "Qwen3-ASR isn't downloaded.".into(),
                session_id: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        client.status(id).await.unwrap().job,
        Some(retranscribe.clone())
    );
    let status = client.retry(id).await.unwrap();
    assert_eq!(status.state, RecordingState::Queued);
    let status = mac
        .server
        .update_status(
            id,
            StatusUpdate::Done {
                session_id: "session-1".into(),
                title: None,
                summary_md: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(status.job, None);

    // A trim while the audio is still arriving drops what arrived.
    let partial = "0b5a4c1e-0000-4000-8000-0000000000bb";
    client
        .upload_chunk(partial, 0, Bytes::from_static(&[1, 2, 3, 4]))
        .await
        .unwrap();
    let status = client
        .note_job(
            partial,
            &NoteJob::Trim {
                keep_ms: 2_000,
                update_summary: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(status.state, RecordingState::Missing);

    // The phone's log replaces the last copy the Mac kept.
    client
        .upload_diagnostics(Bytes::from_static(b"{\"event\":\"first\"}\n"))
        .await
        .unwrap();
    client
        .upload_diagnostics(Bytes::from_static(b"{\"event\":\"second\"}\n"))
        .await
        .unwrap();
    let logs = mac.server.phone_diagnostics();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].phone_name, "Phone A");
    let text = std::fs::read_to_string(&logs[0].path).unwrap();
    assert!(text.starts_with("# phone: Phone A\n"));
    assert!(text.contains("second") && !text.contains("first"));
}

#[tokio::test]
async fn lessons_travel_with_clips_courses_and_reviews() {
    use phone_link::protocol::{ClipInfo, CourseInfo, NoteLesson};

    let mac = start_mac().await;
    mac.server.set_notes_refresh_wait(Duration::ZERO);
    let client = paired_phone(&mac, "Pixel").await;
    let session_id = "11111111-2222-4333-8444-555555555555";
    let other_id = "99999999-2222-4333-8444-555555555555";
    let lesson = NoteSnapshot {
        recording_id: None,
        session_id: session_id.into(),
        title: "Lesson 14".into(),
        summary_md: None,
        transcripts: Vec::new(),
        created_at: Some("2026-11-25T18:00:00Z".into()),
        lesson: Some(NoteLesson {
            settings_json: r#"{"learning":"zh","explainIn":"en"}"#.into(),
            course: Some("Mandarin".into()),
            number: Some(14),
            sheet_json: Some("{}".into()),
            review_json: Some("{}".into()),
            clips: vec![ClipInfo {
                id: "c1000-2000-b".into(),
                size: 3,
                sha256: sha256_hex(b"mp3"),
            }],
            reviews: Vec::new(),
        }),
    };
    let standup = NoteSnapshot {
        session_id: other_id.into(),
        title: "Standup".into(),
        lesson: None,
        ..lesson.clone()
    };
    mac.server
        .publish_notes(vec![lesson.clone(), standup])
        .unwrap();
    mac.server
        .publish_courses(vec![CourseInfo {
            name: "Mandarin".into(),
            subject: "language".into(),
            learning: "zh".into(),
            explain_in: "en".into(),
            subject_name: None,
            next_number: 15,
        }])
        .unwrap();

    // A lesson recorded on the Mac reaches a phone that didn't ask for Mac notes.
    let changes = client.note_changes(0, false).await.unwrap();
    assert_eq!(changes.notes.len(), 1);
    assert_eq!(changes.notes[0].title, "Lesson 14");
    assert_eq!(changes.courses[0].next_number, 15);

    // Only clips the Mac listed with the note can be fetched.
    let dir = mac.server.clips_dir(session_id).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("c1000-2000-b.mp3"), b"mp3").unwrap();
    std::fs::write(dir.join("other.mp3"), b"no").unwrap();
    assert_eq!(
        &client
            .download_clip(session_id, "c1000-2000-b")
            .await
            .unwrap()[..],
        b"mp3"
    );
    assert!(client.download_clip(session_id, "other").await.is_err());
    assert!(
        client
            .download_clip(other_id, "c1000-2000-b")
            .await
            .is_err()
    );
    assert!(client.download_clip(session_id, "../c1000").await.is_err());
    assert!(mac.server.clips_dir("../up").is_none());

    // Reviews are kept until the Mac app counts them; sending twice is harmless.
    let run = r#"{"id":"run-1","results":[]}"#.to_string();
    let accepted = client
        .send_reviews(session_id, vec![run.clone(), "not json".into()])
        .await
        .unwrap();
    assert_eq!(accepted.accepted, vec!["run-1".to_string()]);
    client
        .send_reviews(session_id, vec![run.clone()])
        .await
        .unwrap();
    let pending = mac.server.pending_reviews();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].session_id, session_id);
    assert_eq!(pending[0].run_json, run);
    assert!(mac.events.lock().unwrap().iter().any(|event| matches!(
        event,
        ServerEvent::ReviewsReceived { session_id: id } if id == session_id
    )));
    mac.server.remove_review(session_id, "run-1").unwrap();
    assert!(mac.server.pending_reviews().is_empty());
    // A note that isn't a lesson takes no reviews.
    assert!(client.send_reviews(other_id, vec![run]).await.is_err());
}

#[tokio::test]
async fn a_recording_waiting_on_the_mac_can_be_made_a_lesson() {
    use phone_link::protocol::LessonTag;

    let mac = start_mac().await;
    let client = paired_phone(&mac, "Pixel").await;
    let id = "0b5a4c1e-0000-4000-8000-000000000042";
    send_recording(&client, id, &wav(2_000)).await;
    let tag = LessonTag {
        course: "Mandarin".into(),
        subject: "language".into(),
        learning: "zh".into(),
        explain_in: "en".into(),
        subject_name: None,
    };
    client
        .note_job(
            id,
            &NoteJob::SetLesson {
                lesson: Some(tag.clone()),
            },
        )
        .await
        .unwrap();
    let item = mac
        .server
        .inbox()
        .unwrap()
        .into_iter()
        .find(|item| item.id == id)
        .unwrap();
    assert_eq!(item.meta.lesson, Some(tag.clone()));
    assert!(item.job.is_none());

    // A tag the Mac can't use is refused.
    let bad = NoteJob::SetLesson {
        lesson: Some(LessonTag {
            course: "../Mandarin".into(),
            ..tag
        }),
    };
    assert_eq!(conflict(client.note_job(id, &bad).await), "400 invalid_job");
}
