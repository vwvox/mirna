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
//!
//! Lessons: a recording sent as a lesson (or made one later) also goes through
//! `writing_sheet` and `planning_review`, and comes back with a sample Mandarin
//! sheet, a review plan using every kind of piece, and short tone clips. One
//! lesson "recorded on the Mac" is always published. Reviews the phone sends
//! are printed (REVIEW …) and counted in the next publish.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use phone_link::protocol::{
    ClipInfo, CourseInfo, LessonTag, NoteJob, NoteLesson, NoteSnapshot, NoteTranscript,
    ReviewSummary,
};
use phone_link::server::{PhoneLinkServer, ServerEvent, StatusUpdate};

/// The lesson the stub Mac "recorded" itself.
const MAC_LESSON: &str = "stub-mac-lesson";

/// What the stub remembers between events: which recordings are lessons, and
/// the reviews it has counted.
#[derive(Default)]
struct Lessons {
    tags: HashMap<String, LessonTag>,
    reviews: HashMap<String, Vec<ReviewSummary>>,
}

fn courses() -> Vec<CourseInfo> {
    vec![
        CourseInfo {
            name: "Mandarin".into(),
            subject: "language".into(),
            learning: "zh".into(),
            explain_in: "en".into(),
            subject_name: None,
            next_number: 15,
        },
        CourseInfo {
            name: "Statistics".into(),
            subject: "maths".into(),
            learning: "en".into(),
            explain_in: "en".into(),
            subject_name: Some("Statistics".into()),
            next_number: 3,
        },
    ]
}

/// One second or so of a tone, as 16 kHz mono WAV: enough to hear a clip play.
fn tone_wav(hz: f32, ms: u32) -> Vec<u8> {
    let rate = 16_000u32;
    let samples = rate * ms / 1000;
    let mut bytes = Vec::with_capacity(44 + samples as usize * 2);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + samples * 2).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(samples * 2).to_le_bytes());
    for index in 0..samples {
        let t = index as f32 / rate as f32;
        let fade = (index.min(samples - index) as f32 / 800.0).min(1.0);
        let value = (t * hz * std::f32::consts::TAU).sin() * 9_000.0 * fade;
        bytes.extend_from_slice(&(value as i16).to_le_bytes());
    }
    bytes
}

fn clip(id: &str, start_ms: u64, end_ms: u64, label: &str) -> serde_json::Value {
    serde_json::json!({ "id": id, "startMs": start_ms, "endMs": end_ms, "channel": 1, "label": label })
}

/// Writes the sample clips for a lesson and lists them for the phone.
fn lesson_clips(server: &PhoneLinkServer, session_id: &str) -> Vec<ClipInfo> {
    let dir = server.clips_dir(session_id).expect("valid id");
    std::fs::create_dir_all(&dir).unwrap();
    [
        ("c1000-2000-1", 440.0, 900),
        ("c3000-4000-1", 523.0, 900),
        ("c5000-7000-1", 659.0, 1_600),
        ("c8000-9500-1", 392.0, 1_300),
    ]
    .into_iter()
    .map(|(id, hz, ms)| {
        let path = dir.join(format!("{id}.mp3"));
        if !path.exists() {
            std::fs::write(&path, tone_wav(hz, ms)).unwrap();
        }
        ClipInfo {
            id: id.into(),
            size: std::fs::metadata(&path).unwrap().len(),
            sha256: phone_link::sha256_file(&path).unwrap(),
        }
    })
    .collect()
}

fn sample_sheet() -> String {
    let empty: Vec<serde_json::Value> = Vec::new();
    serde_json::json!({
        "sheet": {
            "version": 1,
            "kind": "language",
            "topic": "都 and its negatives",
            "summary": "You practised 都 with verbs and adjectives, and 都不 (none) against 不都 (not all).",
            "chapters": [{ "title": "Warm-up", "startMs": 0 }],
            "vocabulary": [
                { "term": "饺子", "reading": "jiǎozi", "meaning": "dumplings", "note": "noun", "heardAtMs": 1000, "isNew": true },
                { "term": "面条", "reading": "miàntiáo", "meaning": "noodles", "note": "noun", "heardAtMs": 3000, "isNew": true },
                { "term": "好吃", "reading": "hǎochī", "meaning": "tasty, delicious", "note": "adjective", "heardAtMs": null, "isNew": true },
                { "term": "都", "reading": "dōu", "meaning": "all, both", "note": "adverb", "heardAtMs": 5000, "isNew": false }
            ],
            "patterns": [{
                "pattern": "Subject + 都 + verb or adjective",
                "explanation": "都 goes after the subject and before the verb.",
                "examples": [{ "text": "我们也都喝茶。", "translation": "We all drink tea too.", "atMs": 5000 }]
            }],
            "corrections": [{ "said": "我们都也喝茶", "corrected": "我们也都喝茶", "why": "When you need both, 也 comes before 都.", "atMs": 8000 }],
            "homework": [{ "text": "Write five sentences with 都", "due": "Thursday", "atMs": null }],
            "markAnswers": empty,
            "openQuestions": ["Can 都 go with 每?"],
            "translations": empty,
            "talk": null,
            "keyTerms": empty, "ideas": empty, "sources": empty, "methods": empty,
            "checkYourself": empty, "formulas": empty, "workedExamples": empty, "problems": empty
        },
        "generatedAt": "2026-11-25T18:40:00Z",
        "model": "stub",
        "sourceHash": "stub-sheet-1",
        "clips": {
            "word:饺子": clip("c1000-2000-1", 1000, 2000, "Lǎoshī Chen · 0:01"),
            "word:面条": clip("c3000-4000-1", 3000, 4000, "Lǎoshī Chen · 0:03"),
            "example:我们也都喝茶。": clip("c5000-7000-1", 5000, 7000, "Lǎoshī Chen · 0:05"),
            "slip:我们都也喝茶": clip("c8000-9500-1", 8000, 9500, "Lǎoshī Chen · 0:08")
        }
    })
    .to_string()
}

fn piece(id: &str, kind: &str, core: bool, prompt: &str, body: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "id": id, "kind": kind, "core": core, "seconds": 45, "written": false,
        "source": "", "prompt": prompt, "body": body, "explain": "",
        "clips": [], "cardId": null, "markId": null
    })
}

/// A plan with every kind of body the phone plays, the 5-minute ones marked core.
fn sample_review() -> String {
    let mut big = piece("p-big", "big_picture", true, "What was this lesson about?", serde_json::json!({
        "type": "reveal",
        "front": { "text": "都 and its negatives" },
        "back": [
            { "text": "都 means all or both, and goes before the verb." },
            { "text": "都不: none · 不都: not all" }
        ]
    }));
    big["clips"] = serde_json::json!([clip("c5000-7000-1", 5000, 7000, "Lǎoshī Chen · 0:05")]);
    let quick = piece("p-quick", "quick_fire", true, "Say each word, then turn it over", serde_json::json!({
        "type": "cards",
        "items": [
            { "front": { "text": "饺子", "learning": true }, "back": { "text": "dumplings", "reading": "jiǎozi" }, "clip": clip("c1000-2000-1", 1000, 2000, "Lǎoshī Chen · 0:01"), "cardId": "饺子" },
            { "front": { "text": "面条", "learning": true }, "back": { "text": "noodles", "reading": "miàntiáo" }, "clip": clip("c3000-4000-1", 3000, 4000, "Lǎoshī Chen · 0:03"), "cardId": "面条" },
            { "front": { "text": "好吃", "learning": true }, "back": { "text": "tasty, delicious", "reading": "hǎochī" }, "clip": null, "cardId": "好吃" }
        ]
    }));
    let listen = piece("p-listen", "listen_pick", true, "Which did Lǎoshī Chen say?", serde_json::json!({
        "type": "choice",
        "context": null,
        "listen": clip("c5000-7000-1", 5000, 7000, "Lǎoshī Chen · 0:05"),
        "options": [
            { "text": "我们也都喝茶。", "sub": "We all drink tea too." },
            { "text": "我们都不喝茶。", "sub": "None of us drink tea." }
        ],
        "answer": 0,
        "reveal": [{ "text": "我们也都喝茶。", "reading": "Wǒmen yě dōu hē chá." }]
    }));
    let mut fix = piece("p-fix", "fix_it", true, "Your slip at 0:08. Put the words in the right order.", serde_json::json!({
        "type": "order",
        "context": { "text": "我们都也喝茶", "struck": true, "sub": "What you said" },
        "items": [{ "text": "我们" }, { "text": "也" }, { "text": "都" }, { "text": "喝茶" }],
        "shuffled": [2, 0, 3, 1]
    }));
    fix["explain"] = "When you need both, 也 comes before 都.".into();
    fix["clips"] = serde_json::json!([clip("c8000-9500-1", 8000, 9500, "Lǎoshī Chen · 0:08")]);
    fix["cardId"] = "slip:我们都也喝茶".into();
    let sort = piece("p-sort", "sort_it", false, "None, or not all?", serde_json::json!({
        "type": "sort",
        "groups": [{ "title": "都不", "hint": "none" }, { "title": "不都", "hint": "not all" }],
        "cards": [
            { "text": "None of us like coffee", "group": 0, "why": "None: 都不" },
            { "text": "Not all of them came", "group": 1, "why": "Not all: 不都" },
            { "text": "Nobody is tired", "group": 0, "why": "None: 都不" }
        ]
    }));
    let sum = piece("p-sum", "twin_problem", false, "Work it out", serde_json::json!({
        "type": "number",
        "context": { "text": "饺子 cost ¥18 a plate. You buy 3 plates and pay ¥100. How much change?" },
        "steps": [{ "text": "3 × 18 = 54" }, { "text": "100 − 54 = 46" }],
        "answer": 46,
        "answerText": "¥46"
    }));
    serde_json::json!({
        "plan": {
            "version": 1, "mindset": "language", "learning": "zh", "explainIn": "en",
            "withAi": false,
            "pieces": [big, quick, listen, fix, sort, sum]
        },
        "generatedAt": "2026-11-25T18:41:00Z",
        "model": null,
        "sourceHash": "stub-review-1"
    })
    .to_string()
}

fn lesson_note(
    server: &PhoneLinkServer,
    session_id: &str,
    tag: &LessonTag,
    number: u32,
    lessons: &Lessons,
) -> NoteLesson {
    NoteLesson {
        settings_json: serde_json::json!({
            "learning": tag.learning, "explainIn": tag.explain_in, "subject": tag.subject
        })
        .to_string(),
        course: Some(tag.course.clone()),
        number: Some(number),
        sheet_json: Some(sample_sheet()),
        review_json: Some(sample_review()),
        clips: lesson_clips(server, session_id),
        reviews: lessons.reviews.get(session_id).cloned().unwrap_or_default(),
    }
}

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

fn publish_all(server: &PhoneLinkServer, dir: &str, include_mac_notes: bool, lessons: &Lessons) {
    let added = Path::new(dir).join("added-on-mac").exists();
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
            let lesson = lessons
                .tags
                .get(&recording_id)
                .map(|tag| lesson_note(server, &session_id, tag, 15, lessons));
            NoteSnapshot {
                recording_id: Some(recording_id),
                session_id,
                title: "Test note from the stub Mac".into(),
                summary_md: Some(summary),
                transcripts,
                created_at: None,
                lesson,
            }
        })
        .collect::<Vec<_>>();
    let mut notes = notes;
    // Lessons recorded on the Mac go to phones whatever the phone asked.
    let mandarin = LessonTag {
        course: "Mandarin".into(),
        subject: "language".into(),
        learning: "zh".into(),
        explain_in: "en".into(),
        subject_name: None,
    };
    notes.push(NoteSnapshot {
        recording_id: None,
        session_id: MAC_LESSON.into(),
        title: "都 and its negatives".into(),
        summary_md: Some("- 都 before the verb\n- 都不 (none) and 不都 (not all)".into()),
        transcripts: vec![NoteTranscript {
            id: format!("{MAC_LESSON}-t1"),
            started_at_ms: now - 7_200_000,
            ended_at_ms: Some(now - 4_000_000),
            memo: String::new(),
            words_json: words("我们也都喝茶。 We all drink tea too.", 0),
            speaker_hints_json: "[]".into(),
        }],
        created_at: Some("2026-11-25T18:00:00Z".into()),
        lesson: Some(lesson_note(server, MAC_LESSON, &mandarin, 14, lessons)),
    });
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
            lesson: None,
        });
    }
    server.publish_courses(courses()).unwrap();
    let changed = server.publish_notes(notes).unwrap();
    println!("PUBLISHED {changed} changed (mac notes asked: {include_mac_notes})");
}

/// Counts a review the phone sent, as the Mac app would, for the next publish.
fn count_review(lessons: &mut Lessons, session_id: &str, run_json: &str) {
    let Ok(run) = serde_json::from_str::<serde_json::Value>(run_json) else {
        return;
    };
    let results = run["results"].as_array().cloned().unwrap_or_default();
    let right = results
        .iter()
        .filter(|result| result["outcome"] == "knew")
        .count() as u32;
    let summary = ReviewSummary {
        id: run["id"].as_str().unwrap_or_default().into(),
        ended_at: run["endedAt"].as_str().unwrap_or_default().into(),
        device: run["device"].as_str().unwrap_or("phone").into(),
        length: run["length"].as_u64().unwrap_or(5) as u32,
        right,
        total: results.len() as u32,
    };
    let counted = lessons.reviews.entry(session_id.into()).or_default();
    if !counted.iter().any(|review| review.id == summary.id) {
        counted.push(summary);
    }
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
    server.publish_courses(courses()).unwrap();
    let mut lessons = Lessons::default();
    let offer = server.begin_pairing(addresses, port, Duration::from_secs(3600));
    println!("PAIRING {}", offer.to_uri());

    let serving = server.clone();
    tokio::spawn(async move { serving.serve(listener, std::future::pending()).await });

    while let Some(event) = rx.recv().await {
        match event {
            ServerEvent::PhonePaired { name, .. } => println!("PAIRED {name}"),
            ServerEvent::ReviewsReceived { .. } => {
                for review in server.pending_reviews() {
                    println!("REVIEW {} {}", review.session_id, review.run_json);
                    count_review(&mut lessons, &review.session_id, &review.run_json);
                    let _ = server.remove_review(&review.session_id, &review.id);
                }
                publish_all(&server, &dir, false, &lessons);
            }
            ServerEvent::NotesRequested { include_mac_notes } => {
                publish_all(&server, &dir, include_mac_notes, &lessons)
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
                    "RECEIVED {id} {size} bytes title={:?} started_at={:?} notes={:?} lesson={:?} job={:?} note={:?}",
                    item.meta.title,
                    item.meta.started_at,
                    item.meta.notes_md,
                    item.meta.lesson,
                    item.job,
                    item.status.session_id
                );
                // A lesson said with the recording, or changed on a note later.
                let tag = match &item.job {
                    Some(NoteJob::SetLesson { lesson }) => lesson.clone(),
                    _ => item.meta.lesson.clone(),
                };
                match tag {
                    Some(tag) => {
                        lessons.tags.insert(id.clone(), tag);
                    }
                    None if matches!(item.job, Some(NoteJob::SetLesson { .. })) => {
                        lessons.tags.remove(&id);
                    }
                    None => {}
                }
                let stages: &[&str] = if lessons.tags.contains_key(&id) {
                    &["transcribing", "summarizing", "writing_sheet", "planning_review"]
                } else {
                    &["transcribing", "summarizing"]
                };
                let server = server.clone();
                tokio::spawn(async move {
                    for stage in stages {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        server
                            .update_status(
                                &id,
                                StatusUpdate::Processing {
                                    stage: (*stage).into(),
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
