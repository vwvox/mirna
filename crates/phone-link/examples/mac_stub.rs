//! A stand-in for the Mac app, for testing the phone without the desktop build.
//!
//!   cargo run -p phone-link --features server --example mac_stub -- <state-dir> <address>...
//!
//! Prints the pairing link, accepts recordings, and pretends to transcribe
//! them: each one goes queued → transcribing → summarizing → done, with a
//! made-up title and summary, a few seconds apart.
//!
//! When the phone asks what changed, it publishes each note's text with a
//! one-line transcript. Create the file `<state-dir>/added-on-mac` to pretend a
//! second recording was added to every note on the Mac.

use std::time::Duration;

use phone_link::protocol::{NoteSnapshot, NoteTranscript};
use phone_link::server::{PhoneLinkServer, ServerEvent, StatusUpdate};

fn words(text: &str, offset_ms: i64) -> String {
    let words: Vec<serde_json::Value> = text
        .split_whitespace()
        .enumerate()
        .map(|(index, word)| {
            let start = offset_ms + index as i64 * 400;
            serde_json::json!({
                "text": word, "start_ms": start, "end_ms": start + 350,
                "channel": 0, "speaker_index": 0
            })
        })
        .collect();
    serde_json::to_string(&words).unwrap()
}

fn publish_all(server: &PhoneLinkServer, dir: &str, include_mac_notes: bool) {
    let added = std::path::Path::new(dir).join("added-on-mac").exists();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let notes = server
        .linked_notes()
        .unwrap()
        .into_iter()
        .map(|(recording_id, session_id)| {
            let mut transcripts = vec![NoteTranscript {
                id: format!("{session_id}-t1"),
                started_at_ms: 1,
                ended_at_ms: Some(8_000),
                memo: String::new(),
                words_json: words("This is the transcript the stub Mac made of your recording. 我们今天练习了便宜和贵。", 0),
                speaker_hints_json: "[]".into(),
            }];
            let mut summary =
                "# Test note\n\n- The stub Mac received this recording.\n- The phone fetched this summary.".to_string();
            if added {
                transcripts.push(NoteTranscript {
                    id: format!("{session_id}-t2"),
                    started_at_ms: now - 120_000,
                    ended_at_ms: Some(now),
                    memo: String::new(),
                    words_json: words("And this part was recorded later on the Mac.", 0),
                    speaker_hints_json: "[]".into(),
                });
                summary.push_str("\n- A second recording was added on the Mac.");
            }
            NoteSnapshot {
                recording_id: Some(recording_id),
                session_id,
                title: "Test note from the stub Mac".into(),
                summary_md: Some(summary),
                transcripts,
                created_at: None,
            }
        })
        .collect::<Vec<_>>();
    let mut notes = notes;
    if include_mac_notes {
        notes.push(NoteSnapshot {
            recording_id: None,
            session_id: "stub-mac-meeting".into(),
            title: "Meeting recorded on the stub Mac".into(),
            summary_md: Some(
                "- This note was recorded on the Mac.\n- Only its text is on the phone.".into(),
            ),
            transcripts: vec![NoteTranscript {
                id: "stub-mac-meeting-t1".into(),
                started_at_ms: now - 3_600_000,
                ended_at_ms: Some(now - 3_000_000),
                memo: String::new(),
                words_json: words("Hello from a meeting recorded on the Mac.", 0),
                speaker_hints_json: "[]".into(),
            }],
            created_at: Some("2026-11-22T15:00:00Z".into()),
        });
    }
    let changed = server.publish_notes(notes).unwrap();
    println!("PUBLISHED {changed} changed (mac notes asked: {include_mac_notes})");
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("state dir");
    let addresses: Vec<String> = args.collect();
    let server = PhoneLinkServer::open(&dir, "Stub Mac").expect("open");
    // MIRNA_STUB_PORT picks another port when the real Mac app is listening.
    let port: u16 = std::env::var("MIRNA_STUB_PORT")
        .ok()
        .and_then(|port| port.parse().ok())
        .unwrap_or(phone_link::DEFAULT_PORT);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind");
    let port = listener.local_addr().unwrap().port();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerEvent>();
    server.set_event_sink(move |event| {
        let _ = tx.send(event);
    });
    let offer = server.begin_pairing(addresses, port, Duration::from_secs(3600));
    println!("PAIRING {}", offer.to_uri());

    let serving = server.clone();
    tokio::spawn(async move { serving.serve(listener, std::future::pending()).await });

    while let Some(event) = rx.recv().await {
        match event {
            ServerEvent::PhonePaired { name, .. } => println!("PAIRED {name}"),
            ServerEvent::NotesRequested { include_mac_notes } => {
                publish_all(&server, &dir, include_mac_notes)
            }
            ServerEvent::RecordingReceived { id } => {
                let item = server
                    .inbox()
                    .unwrap()
                    .into_iter()
                    .find(|item| item.id == id)
                    .unwrap();
                let size = std::fs::metadata(&item.audio_path)
                    .map(|m| m.len())
                    .unwrap_or(0);
                println!(
                    "RECEIVED {id} {size} bytes title={:?} started_at={:?} notes={:?} job={:?} note={:?}",
                    item.meta.title,
                    item.meta.started_at,
                    item.meta.notes_md,
                    item.job,
                    item.status.session_id
                );
                let server = server.clone();
                tokio::spawn(async move {
                    for stage in ["transcribing", "summarizing"] {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        server
                            .update_status(
                                &id,
                                StatusUpdate::Processing {
                                    stage: stage.into(),
                                    session_id: Some(format!("mac-{id}")),
                                },
                            )
                            .await
                            .unwrap();
                        println!("STAGE {id} {stage}");
                    }
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    server
                        .update_status(
                            &id,
                            StatusUpdate::Done {
                                session_id: format!("mac-{id}"),
                                title: Some("Test note from the stub Mac".into()),
                                summary_md: Some(
                                    "# Test note\n\n- The stub Mac received this recording.\n- The phone fetched this summary."
                                        .into(),
                                ),
                            },
                        )
                        .await
                        .unwrap();
                    println!("DONE {id}");
                });
            }
        }
    }
}
