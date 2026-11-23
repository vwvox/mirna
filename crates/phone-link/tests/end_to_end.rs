#![cfg(all(feature = "client", feature = "server"))]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use phone_link::client::{Client, MacTarget};
use phone_link::protocol::{
    CompleteRequest, NoteSnapshot, NoteTranscript, RecordingMeta, RecordingState,
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
