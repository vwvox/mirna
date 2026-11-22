//! A stand-in for the Mac app, for testing the phone without the desktop build.
//!
//!   cargo run -p phone-link --features server --example mac_stub -- <state-dir> <address>...
//!
//! Prints the pairing link, accepts recordings, and pretends to transcribe
//! them: each one goes queued → transcribing → summarizing → done, with a
//! made-up title and summary, a few seconds apart.

use std::time::Duration;

use phone_link::server::{PhoneLinkServer, ServerEvent, StatusUpdate};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("state dir");
    let addresses: Vec<String> = args.collect();
    let server = PhoneLinkServer::open(&dir, "Stub Mac").expect("open");
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", phone_link::DEFAULT_PORT))
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
                    "RECEIVED {id} {size} bytes title={:?} started_at={:?} notes={:?}",
                    item.meta.title, item.meta.started_at, item.meta.notes_md
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
