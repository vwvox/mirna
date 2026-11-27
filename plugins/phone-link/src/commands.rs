use std::sync::Arc;

use anlg_phone_link::protocol::{NoteJob, NoteSnapshot, NoteTranscript, RecordingState};
use anlg_phone_link::server::{PhoneLinkServer, StatusUpdate};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::PhoneLinkState;
use crate::runner;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PhoneLinkStatus {
    /// Whether the Mac is listening for its phones right now.
    pub listening: bool,
    pub port: Option<u16>,
    pub mac_name: String,
    pub addresses: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PairingInfo {
    /// What the QR code encodes.
    pub uri: String,
    /// The QR code as an SVG document.
    pub qr_svg: String,
    pub expires_in_secs: u32,
    pub mac_name: String,
    pub addresses: Vec<String>,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PairedPhoneInfo {
    pub fingerprint: String,
    pub name: String,
    pub paired_at_ms: f64,
    pub last_seen_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct InboxEntry {
    pub id: String,
    pub audio_path: String,
    pub title: Option<String>,
    pub started_at: Option<String>,
    pub duration_ms: Option<f64>,
    pub notes_md: Option<String>,
    pub phone_name: String,
    pub received_at_ms: f64,
    /// `queued` or `processing`.
    pub state: String,
    pub stage: Option<String>,
    pub session_id: Option<String>,
    /// Set when the phone asked for more work on a note it already has.
    pub job: Option<InboxJob>,
}

/// Work the phone asked for on a note: transcribe again (`engine` is `auto`,
/// `parakeet` or `qwen3`), keep only the first `keep_ms` of the recording, or
/// make the note again from a longer recording the phone just sent (`extend`).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InboxJob {
    Retranscribe {
        engine: String,
        update_summary: bool,
    },
    Trim {
        keep_ms: f64,
        update_summary: bool,
    },
    Extend {
        update_summary: bool,
    },
}

impl From<NoteJob> for InboxJob {
    fn from(job: NoteJob) -> Self {
        match job {
            NoteJob::Retranscribe {
                engine,
                update_summary,
            } => InboxJob::Retranscribe {
                engine,
                update_summary,
            },
            NoteJob::Trim {
                keep_ms,
                update_summary,
            } => InboxJob::Trim {
                keep_ms: keep_ms as f64,
                update_summary,
            },
            NoteJob::Extend { update_summary } => InboxJob::Extend { update_summary },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecordingUpdate {
    Processing {
        stage: String,
        session_id: Option<String>,
    },
    Done {
        session_id: String,
        title: Option<String>,
        summary_md: Option<String>,
    },
    Failed {
        error: String,
        session_id: Option<String>,
    },
    Requeue,
}

/// A phone recording that became a note on this Mac.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkedNote {
    pub recording_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PublishedTranscript {
    pub id: String,
    pub started_at_ms: f64,
    pub ended_at_ms: Option<f64>,
    pub memo: String,
    pub words_json: String,
    pub speaker_hints_json: String,
}

/// The current text of a note for the phones: one that began as a phone
/// recording (`recording_id` set) or one recorded on this Mac. Never audio.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PublishedNote {
    pub recording_id: Option<String>,
    pub session_id: String,
    pub title: String,
    pub summary_md: Option<String>,
    pub transcripts: Vec<PublishedTranscript>,
    /// When the note was made, for notes recorded on this Mac.
    pub created_at: Option<String>,
}

impl From<PublishedNote> for NoteSnapshot {
    fn from(note: PublishedNote) -> Self {
        NoteSnapshot {
            recording_id: note.recording_id,
            session_id: note.session_id,
            title: note.title,
            summary_md: note.summary_md,
            created_at: note.created_at,
            transcripts: note
                .transcripts
                .into_iter()
                .map(|transcript| NoteTranscript {
                    id: transcript.id,
                    started_at_ms: transcript.started_at_ms as i64,
                    ended_at_ms: transcript.ended_at_ms.map(|ms| ms as i64),
                    memo: transcript.memo,
                    words_json: transcript.words_json,
                    speaker_hints_json: transcript.speaker_hints_json,
                })
                .collect(),
        }
    }
}

fn state<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Arc<PhoneLinkState> {
    app.state::<Arc<PhoneLinkState>>().inner().clone()
}

fn server(state: &PhoneLinkState) -> Result<&PhoneLinkServer, String> {
    state.server.as_ref().ok_or_else(|| {
        state
            .open_error
            .clone()
            .unwrap_or_else(|| "Phone link is unavailable".into())
    })
}

pub(crate) async fn ensure_running(state: &PhoneLinkState) -> Option<u16> {
    let server = state.server.as_ref()?;
    let mut running = state.running.lock().await;
    if let Some(running) = running.as_ref() {
        return Some(running.port);
    }
    match runner::start(server).await {
        Ok(started) => {
            let port = started.port;
            *running = Some(started);
            if let Ok(mut error) = state.last_error.lock() {
                *error = None;
            }
            Some(port)
        }
        Err(error) => {
            tracing::error!(%error, "phone link did not start");
            if let Ok(mut last) = state.last_error.lock() {
                *last = Some(error);
            }
            None
        }
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PhoneLinkStatus, String> {
    let state = state(&app);
    let port = state
        .running
        .lock()
        .await
        .as_ref()
        .map(|running| running.port);
    let error = state
        .open_error
        .clone()
        .or_else(|| state.last_error.lock().ok().and_then(|error| error.clone()));
    Ok(PhoneLinkStatus {
        listening: port.is_some(),
        port,
        mac_name: state
            .server
            .as_ref()
            .map(PhoneLinkServer::mac_name)
            .unwrap_or_default(),
        addresses: runner::local_addresses(),
        error,
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn start_pairing<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PairingInfo, String> {
    let state = state(&app);
    let server = server(&state)?;
    let port = ensure_running(&state).await.ok_or_else(|| {
        state
            .last_error
            .lock()
            .ok()
            .and_then(|error| error.clone())
            .unwrap_or_else(|| "Could not start listening for the phone".into())
    })?;
    let addresses = runner::local_addresses();
    if addresses.is_empty() {
        return Err("This Mac isn't on a local network. Connect to Wi-Fi and try again.".into());
    }
    let offer = server.begin_pairing(addresses.clone(), port, runner::PAIRING_TTL);
    let uri = offer.to_uri();
    let qr_svg = qrcode::QrCode::with_error_correction_level(&uri, qrcode::EcLevel::M)
        .map_err(|error| error.to_string())?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(qrcode::render::svg::Color("#2E4A3B"))
        .light_color(qrcode::render::svg::Color("#FBFAF6"))
        .build();
    Ok(PairingInfo {
        uri,
        qr_svg,
        expires_in_secs: runner::PAIRING_TTL.as_secs() as u32,
        mac_name: server.mac_name(),
        addresses,
        port,
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn cancel_pairing<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let state = state(&app);
    let server = server(&state)?;
    server.cancel_pairing();
    if server.paired_phones().is_empty() {
        *state.running.lock().await = None;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn list_phones<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<PairedPhoneInfo>, String> {
    let state = state(&app);
    Ok(server(&state)?
        .paired_phones()
        .into_iter()
        .map(|phone| PairedPhoneInfo {
            fingerprint: phone.fingerprint,
            name: phone.name,
            paired_at_ms: phone.paired_at_ms as f64,
            last_seen_ms: phone.last_seen_ms.map(|ms| ms as f64),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn remove_phone<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    fingerprint: String,
) -> Result<bool, String> {
    let state = state(&app);
    let server = server(&state)?;
    let removed = server
        .remove_phone(&fingerprint)
        .map_err(|error| error.to_string())?;
    if server.paired_phones().is_empty() {
        // Nothing left to listen for: close the port and stop announcing.
        *state.running.lock().await = None;
    }
    Ok(removed)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn list_inbox<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<InboxEntry>, String> {
    let state = state(&app);
    let items = server(&state)?.inbox().map_err(|error| error.to_string())?;
    Ok(items
        .into_iter()
        .map(|item| InboxEntry {
            id: item.id,
            audio_path: item.audio_path.to_string_lossy().to_string(),
            title: item.meta.title,
            started_at: item.meta.started_at,
            duration_ms: item.meta.duration_ms.map(|ms| ms as f64),
            notes_md: item.meta.notes_md,
            phone_name: item.phone_name,
            received_at_ms: item.received_at_ms as f64,
            state: match item.status.state {
                RecordingState::Processing => "processing",
                _ => "queued",
            }
            .to_string(),
            stage: item.status.stage,
            session_id: item.status.session_id,
            job: item.job.map(InboxJob::from),
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn update_recording<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    update: RecordingUpdate,
) -> Result<(), String> {
    let state = state(&app);
    let update = match update {
        RecordingUpdate::Processing { stage, session_id } => {
            StatusUpdate::Processing { stage, session_id }
        }
        RecordingUpdate::Done {
            session_id,
            title,
            summary_md,
        } => StatusUpdate::Done {
            session_id,
            title,
            summary_md,
        },
        RecordingUpdate::Failed { error, session_id } => StatusUpdate::Failed { error, session_id },
        RecordingUpdate::Requeue => StatusUpdate::Requeue,
    };
    server(&state)?
        .update_status(&id, update)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn list_linked_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<LinkedNote>, String> {
    let state = state(&app);
    Ok(server(&state)?
        .linked_notes()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(recording_id, session_id)| LinkedNote {
            recording_id,
            session_id,
        })
        .collect())
}

/// Hands the phones the current text of their notes. Returns how many changed.
#[tauri::command]
#[specta::specta]
pub(crate) async fn publish_notes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    notes: Vec<PublishedNote>,
) -> Result<u32, String> {
    let state = state(&app);
    let server = server(&state)?.clone();
    let notes: Vec<NoteSnapshot> = notes.into_iter().map(NoteSnapshot::from).collect();
    tauri::async_runtime::spawn_blocking(move || server.publish_notes(notes))
        .await
        .map_err(|error| error.to_string())?
        .map(|changed| changed as u32)
        .map_err(|error| error.to_string())
}

/// Largest part of this Mac's own log that goes into an export.
const EXPORT_MAC_LOG_BYTES: u64 = 8 * 1024 * 1024;

/// Writes one text file for someone helping with a problem: this Mac's log
/// (its most recent part) and the logs paired phones sent. The logs record
/// what Mirna did and what went wrong, not notes, transcripts or audio.
/// Returns where the file was written.
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_logs<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    destination: String,
) -> Result<String, String> {
    let state = state(&app);
    let phones = state
        .server
        .as_ref()
        .map(PhoneLinkServer::phone_diagnostics)
        .unwrap_or_default();
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    let version = app.package_info().version.to_string();
    let destination = std::path::PathBuf::from(destination);
    tauri::async_runtime::spawn_blocking(move || {
        write_log_export(&destination, &version, &log_dir, &phones)?;
        Ok::<_, std::io::Error>(destination.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("Couldn't write the logs: {error}"))
}

pub(crate) fn write_log_export(
    destination: &std::path::Path,
    version: &str,
    log_dir: &std::path::Path,
    phones: &[anlg_phone_link::server::PhoneDiagnostics],
) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom, Write};
    let mut out = std::io::BufWriter::new(std::fs::File::create(destination)?);
    writeln!(out, "# Mirna logs")?;
    writeln!(out, "# app: Mirna for Mac {version}")?;
    writeln!(
        out,
        "# system: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    )?;
    writeln!(
        out,
        "# exported: {}",
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    )?;
    writeln!(out, "# phones: {}", phones.len())?;
    writeln!(out)?;

    writeln!(out, "===== Mac log =====")?;
    let mac_log = log_dir.join("app.log");
    match std::fs::File::open(&mac_log) {
        Ok(mut file) => {
            let len = file.metadata()?.len();
            if len > EXPORT_MAC_LOG_BYTES {
                writeln!(out, "(earlier lines left out; showing the last 8 MB)")?;
                file.seek(SeekFrom::Start(len - EXPORT_MAC_LOG_BYTES))?;
            }
            let mut text = Vec::new();
            file.read_to_end(&mut text)?;
            out.write_all(&text)?;
        }
        Err(error) => writeln!(out, "(no Mac log: {error})")?,
    }

    for phone in phones {
        writeln!(out)?;
        writeln!(out, "===== Phone log: {} =====", phone.phone_name)?;
        match std::fs::read(&phone.path) {
            Ok(text) => out.write_all(&text)?,
            Err(error) => writeln!(out, "(couldn't read it: {error})")?,
        }
    }
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_has_the_mac_log_and_each_phone_log() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("app.log"), "mac line\n").unwrap();
        let phone_log = dir.path().join("phone.log");
        std::fs::write(
            &phone_log,
            "# phone: Pixel\n{\"event\":\"recording_saved\"}\n",
        )
        .unwrap();
        let destination = dir.path().join("export.txt");
        write_log_export(
            &destination,
            "1.2.3",
            dir.path(),
            &[anlg_phone_link::server::PhoneDiagnostics {
                phone_name: "Pixel".into(),
                path: phone_log,
                received_at_ms: 0,
            }],
        )
        .unwrap();
        let text = std::fs::read_to_string(destination).unwrap();
        assert!(text.contains("# app: Mirna for Mac 1.2.3"));
        assert!(text.contains("===== Mac log =====\nmac line"));
        assert!(text.contains("===== Phone log: Pixel ====="));
        assert!(text.contains("recording_saved"));
    }
}
