//! Mac side: accepts pairing and recordings from paired phones.
//!
//! Layout of the state folder:
//!
//! ```text
//! identity.json            the Mac's certificate and key (mode 0600)
//! paired.json              trusted phones, by certificate fingerprint
//! inbox/<id>/owner         fingerprint of the phone that sent it
//! inbox/<id>/audio.part    while the upload is in progress
//! inbox/<id>/audio.<ext>   once complete and verified
//! inbox/<id>/meta.json     what the phone said about the recording
//! inbox/<id>/status.json   where the Mac is with it
//! notes.json               text of the notes those recordings became, for
//!                          the phones to download (never the audio)
//! diagnostics/<phone>.log  each phone's problem log, as it last sent it
//! ```

use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, Extension, Path as UrlPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use bytes::Bytes;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

use crate::protocol::{
    ChunkResponse, CompleteRequest, ErrorBody, MacInfo, NoteChangesRequest, NoteChangesResponse,
    NoteJob, NoteSnapshot, PairRequest, PairResponse, RecordingMeta, RecordingState,
    RecordingStatus, StatusesRequest, is_valid_recording_id,
};
use crate::{
    AUDIO_EXTENSIONS, Error, Identity, MAX_CHUNK_BYTES, MAX_DIAGNOSTICS_BYTES, MAX_RECORDING_BYTES,
    PROTOCOL_VERSION, PairingOffer, fingerprint_of_der, now_ms, short_id,
};

const TLS_ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
const PAIRING_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/// How long a phone's request for note changes waits for the Mac app to
/// publish fresh copies first.
const NOTES_REFRESH_WAIT: Duration = Duration::from_millis(2500);
const NOTE_CHANGES_PAGE: usize = 25;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedPhone {
    pub fingerprint: String,
    pub name: String,
    pub paired_at_ms: u64,
    #[serde(default)]
    pub last_seen_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub enum ServerEvent {
    PhonePaired {
        name: String,
        fingerprint: String,
    },
    RecordingReceived {
        id: String,
    },
    /// A phone asked what changed: the Mac app should call `publish_notes`,
    /// including notes recorded on the Mac when `include_mac_notes` is set.
    NotesRequested {
        include_mac_notes: bool,
    },
}

/// A complete recording waiting for, or in, processing on the Mac, or a note
/// the phone asked the Mac to work on again (`job`). For a job the audio is
/// the note's own copy, so `audio_path` may no longer exist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub audio_path: PathBuf,
    pub meta: RecordingMeta,
    pub phone_name: String,
    pub received_at_ms: u64,
    pub status: RecordingStatus,
    pub job: Option<NoteJob>,
}

/// A phone's problem log as the Mac last received it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneDiagnostics {
    pub phone_name: String,
    pub path: PathBuf,
    pub received_at_ms: u64,
}

/// Changes the Mac app makes while it turns a recording into a note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StatusUpdate {
    Processing {
        stage: String,
        #[serde(default)]
        session_id: Option<String>,
    },
    Done {
        session_id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        summary_md: Option<String>,
    },
    Failed {
        error: String,
        #[serde(default)]
        session_id: Option<String>,
    },
    /// Put a failed or interrupted recording back in the queue.
    Requeue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMeta {
    meta: RecordingMeta,
    phone_fingerprint: String,
    phone_name: String,
    received_at_ms: u64,
    size: u64,
    sha256: String,
}

type EventSink = Arc<dyn Fn(ServerEvent) + Send + Sync>;

struct ActiveOffer {
    code: String,
    expires_at: Instant,
}

/// notes.json: every published note with the change number it last got.
#[derive(Default, Serialize, Deserialize)]
struct NotesFile {
    seq: u64,
    notes: BTreeMap<String, StoredNote>,
}

#[derive(Serialize, Deserialize)]
struct StoredNote {
    seq: u64,
    hash: String,
    note: NoteSnapshot,
}

struct Inner {
    dir: PathBuf,
    fingerprint: String,
    mac_name: RwLock<String>,
    acceptor: TlsAcceptor,
    paired: Mutex<Vec<PairedPhone>>,
    offer: Mutex<Option<ActiveOffer>>,
    events: RwLock<Option<EventSink>>,
    // One writer at a time keeps appends, renames and status files simple.
    write_lock: tokio::sync::Mutex<()>,
    notes: Mutex<NotesFile>,
    notes_published: tokio::sync::Notify,
    notes_refresh_wait_ms: AtomicU64,
}

#[derive(Clone)]
pub struct PhoneLinkServer {
    inner: Arc<Inner>,
}

#[derive(Clone)]
struct Peer {
    fingerprint: String,
}

impl PhoneLinkServer {
    /// Opens the state folder, creating the Mac's identity on first use.
    pub fn open(dir: impl Into<PathBuf>, mac_name: impl Into<String>) -> Result<Self, Error> {
        let dir = dir.into();
        std::fs::create_dir_all(dir.join("inbox"))?;
        let identity = load_or_create_identity(&dir.join("identity.json"))?;
        let fingerprint = identity.fingerprint()?;
        let acceptor = TlsAcceptor::from(crate::tls::server_config(&identity)?);
        let paired = read_json::<Vec<PairedPhone>>(&dir.join("paired.json"))
            .ok()
            .flatten()
            .unwrap_or_default();
        let notes = read_json::<NotesFile>(&dir.join("notes.json"))
            .ok()
            .flatten()
            .unwrap_or_default();
        Ok(Self {
            inner: Arc::new(Inner {
                dir,
                fingerprint,
                mac_name: RwLock::new(mac_name.into()),
                acceptor,
                paired: Mutex::new(paired),
                offer: Mutex::new(None),
                events: RwLock::new(None),
                write_lock: tokio::sync::Mutex::new(()),
                notes: Mutex::new(notes),
                notes_published: tokio::sync::Notify::new(),
                notes_refresh_wait_ms: AtomicU64::new(NOTES_REFRESH_WAIT.as_millis() as u64),
            }),
        })
    }

    /// How long a phone's request for note changes waits for `publish_notes`.
    pub fn set_notes_refresh_wait(&self, wait: Duration) {
        self.inner
            .notes_refresh_wait_ms
            .store(wait.as_millis() as u64, Ordering::Relaxed);
    }

    /// Recordings that have become notes on this Mac, as (recording id, note id).
    pub fn linked_notes(&self) -> Result<Vec<(String, String)>, Error> {
        let mut linked = Vec::new();
        for entry in std::fs::read_dir(self.inner.dir.join("inbox"))? {
            let Some(id) = entry?.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !is_valid_recording_id(&id) {
                continue;
            }
            let status = self.inner.read_status(&id);
            if let (RecordingState::Done, Some(session_id)) = (status.state, status.session_id) {
                linked.push((id, session_id));
            }
        }
        linked.sort();
        Ok(linked)
    }

    /// Stores the current text of notes, so the phones can download what
    /// changed: notes from phone recordings (shown only to the phone that sent
    /// them) and notes recorded on the Mac (shown to phones that ask for them).
    /// Unchanged notes, and notes for recordings no phone sent, are skipped.
    /// Returns how many changed.
    pub fn publish_notes(&self, notes: Vec<NoteSnapshot>) -> Result<usize, Error> {
        let mut changed = 0;
        {
            let mut file = self
                .inner
                .notes
                .lock()
                .map_err(|_| Error::Io("notes lock poisoned".into()))?;
            for note in notes {
                let key = match &note.recording_id {
                    Some(recording_id) => {
                        if !is_valid_recording_id(recording_id)
                            || self.inner.owner(recording_id).is_none()
                        {
                            continue;
                        }
                        recording_id.clone()
                    }
                    None => {
                        if note.session_id.is_empty() || note.session_id.len() > 200 {
                            continue;
                        }
                        format!("mac:{}", note.session_id)
                    }
                };
                let hash = hex::encode(Sha256::digest(serde_json::to_vec(&note)?));
                if file
                    .notes
                    .get(&key)
                    .is_some_and(|stored| stored.hash == hash)
                {
                    continue;
                }
                file.seq += 1;
                let seq = file.seq;
                file.notes.insert(key, StoredNote { seq, hash, note });
                changed += 1;
            }
            if changed > 0 {
                write_json(&self.inner.dir.join("notes.json"), &*file)?;
            }
        }
        self.inner.notes_published.notify_waiters();
        Ok(changed)
    }

    pub fn fingerprint(&self) -> String {
        self.inner.fingerprint.clone()
    }

    pub fn mac_id(&self) -> String {
        short_id(&self.inner.fingerprint)
    }

    /// The problem logs paired phones have sent, newest first.
    pub fn phone_diagnostics(&self) -> Vec<PhoneDiagnostics> {
        let dir = self.inner.dir.join("diagnostics");
        let phones = self.paired_phones();
        let mut logs: Vec<PhoneDiagnostics> = phones
            .iter()
            .filter_map(|phone| {
                let path = dir.join(format!("{}.log", short_id(&phone.fingerprint)));
                let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
                Some(PhoneDiagnostics {
                    phone_name: phone.name.clone(),
                    path,
                    received_at_ms: modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|duration| duration.as_millis() as u64)
                        .unwrap_or_default(),
                })
            })
            .collect();
        logs.sort_by_key(|log| std::cmp::Reverse(log.received_at_ms));
        logs
    }

    pub fn mac_name(&self) -> String {
        self.inner
            .mac_name
            .read()
            .map(|name| name.clone())
            .unwrap_or_default()
    }

    pub fn set_mac_name(&self, name: impl Into<String>) {
        if let Ok(mut current) = self.inner.mac_name.write() {
            *current = name.into();
        }
    }

    pub fn set_event_sink(&self, sink: impl Fn(ServerEvent) + Send + Sync + 'static) {
        if let Ok(mut events) = self.inner.events.write() {
            *events = Some(Arc::new(sink));
        }
    }

    /// Starts a pairing window and returns what the QR code should carry.
    /// A new offer replaces any earlier one.
    pub fn begin_pairing(&self, addresses: Vec<String>, port: u16, ttl: Duration) -> PairingOffer {
        let mut rng = rand::rng();
        let code: String = (0..20)
            .map(|_| {
                PAIRING_CODE_ALPHABET[rng.random_range(0..PAIRING_CODE_ALPHABET.len())] as char
            })
            .collect();
        if let Ok(mut offer) = self.inner.offer.lock() {
            *offer = Some(ActiveOffer {
                code: code.clone(),
                expires_at: Instant::now() + ttl,
            });
        }
        PairingOffer {
            mac_id: self.mac_id(),
            mac_name: self.mac_name(),
            addresses,
            port,
            fingerprint: self.fingerprint(),
            code,
        }
    }

    pub fn cancel_pairing(&self) {
        if let Ok(mut offer) = self.inner.offer.lock() {
            *offer = None;
        }
    }

    pub fn paired_phones(&self) -> Vec<PairedPhone> {
        self.inner
            .paired
            .lock()
            .map(|phones| phones.clone())
            .unwrap_or_default()
    }

    pub fn remove_phone(&self, fingerprint: &str) -> Result<bool, Error> {
        let mut phones = self
            .inner
            .paired
            .lock()
            .map_err(|_| Error::Io("paired phones lock poisoned".into()))?;
        let before = phones.len();
        phones.retain(|phone| phone.fingerprint != fingerprint);
        let removed = phones.len() != before;
        if removed {
            write_json(&self.inner.dir.join("paired.json"), &*phones)?;
        }
        Ok(removed)
    }

    /// Complete recordings that are queued or were interrupted mid-processing,
    /// oldest first.
    pub fn inbox(&self) -> Result<Vec<InboxItem>, Error> {
        let mut items = Vec::new();
        for entry in std::fs::read_dir(self.inner.dir.join("inbox"))? {
            let entry = entry?;
            let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !is_valid_recording_id(&id) {
                continue;
            }
            let status = self.inner.read_status(&id);
            if !matches!(
                status.state,
                RecordingState::Queued | RecordingState::Processing
            ) {
                continue;
            }
            let Some(stored) = self.inner.read_meta(&id) else {
                continue;
            };
            let audio_path = self.inner.audio_path(&id, &stored.meta.ext);
            let job = status.job.clone().filter(|_| status.session_id.is_some());
            if job.is_none() && !audio_path.exists() {
                continue;
            }
            items.push(InboxItem {
                id,
                audio_path,
                meta: stored.meta,
                phone_name: stored.phone_name,
                received_at_ms: stored.received_at_ms,
                status,
                job,
            });
        }
        items.sort_by_key(|item| item.received_at_ms);
        Ok(items)
    }

    pub fn status(&self, id: &str) -> RecordingStatus {
        if !is_valid_recording_id(id) {
            return RecordingStatus::missing(id);
        }
        self.inner.read_status(id)
    }

    pub async fn update_status(
        &self,
        id: &str,
        update: StatusUpdate,
    ) -> Result<RecordingStatus, Error> {
        if !is_valid_recording_id(id) {
            return Err(Error::Protocol("invalid recording id".into()));
        }
        let _guard = self.inner.write_lock.lock().await;
        let mut status = self.inner.read_status(id);
        if status.state == RecordingState::Missing || status.state == RecordingState::Receiving {
            return Err(Error::Protocol("recording is not complete".into()));
        }
        match update {
            StatusUpdate::Processing { stage, session_id } => {
                status.state = RecordingState::Processing;
                status.stage = Some(stage);
                if session_id.is_some() {
                    status.session_id = session_id;
                }
                status.error = None;
            }
            StatusUpdate::Done {
                session_id,
                title,
                summary_md,
            } => {
                status.state = RecordingState::Done;
                status.stage = None;
                status.session_id = Some(session_id);
                status.title = title;
                status.summary_md = summary_md;
                status.error = None;
                status.job = None;
                // The note now owns its own copy of the audio.
                if let Some(stored) = self.inner.read_meta(id) {
                    let _ = std::fs::remove_file(self.inner.audio_path(id, &stored.meta.ext));
                }
            }
            StatusUpdate::Failed { error, session_id } => {
                status.state = RecordingState::Failed;
                status.stage = None;
                status.error = Some(error);
                if session_id.is_some() {
                    status.session_id = session_id;
                }
            }
            StatusUpdate::Requeue => {
                status.state = RecordingState::Queued;
                status.stage = None;
                status.error = None;
            }
        }
        status.updated_at_ms = now_ms();
        self.inner.write_status(id, &status)?;
        Ok(status)
    }

    /// Accepts connections until `shutdown` resolves.
    pub async fn serve(&self, listener: TcpListener, shutdown: impl Future<Output = ()>) {
        let router = self.router();
        tokio::pin!(shutdown);
        loop {
            let accepted = tokio::select! {
                _ = &mut shutdown => break,
                accepted = listener.accept() => accepted,
            };
            let (tcp, remote) = match accepted {
                Ok(pair) => pair,
                Err(error) => {
                    tracing::warn!(%error, "phone link accept failed");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };
            let acceptor = self.inner.acceptor.clone();
            let router = router.clone();
            tokio::spawn(async move {
                let tls = match tokio::time::timeout(TLS_ACCEPT_TIMEOUT, acceptor.accept(tcp)).await
                {
                    Ok(Ok(tls)) => tls,
                    Ok(Err(error)) => {
                        tracing::debug!(%remote, %error, "phone link handshake failed");
                        return;
                    }
                    Err(_) => return,
                };
                let Some(fingerprint) = tls
                    .get_ref()
                    .1
                    .peer_certificates()
                    .and_then(|certs| certs.first())
                    .map(|cert| fingerprint_of_der(cert.as_ref()))
                else {
                    return;
                };
                let service = hyper_util::service::TowerToHyperService::new(
                    router.layer(Extension(Peer { fingerprint })),
                );
                if let Err(error) = hyper::server::conn::http1::Builder::new()
                    .serve_connection(hyper_util::rt::TokioIo::new(tls), service)
                    .await
                {
                    tracing::debug!(%remote, %error, "phone link connection ended");
                }
            });
        }
    }

    fn router(&self) -> Router {
        Router::new()
            .route("/v1/info", get(info))
            .route("/v1/pair", post(pair))
            .route("/v1/statuses", post(statuses))
            .route("/v1/recordings/{id}", get(recording_status))
            .route(
                "/v1/recordings/{id}/audio",
                put(upload_chunk).layer(DefaultBodyLimit::max(MAX_CHUNK_BYTES)),
            )
            .route("/v1/recordings/{id}/complete", post(complete))
            .route("/v1/recordings/{id}/retry", post(retry))
            .route("/v1/recordings/{id}/job", post(request_job))
            .route("/v1/notes/changes", post(note_changes))
            .route(
                "/v1/diagnostics",
                put(receive_diagnostics).layer(DefaultBodyLimit::max(MAX_DIAGNOSTICS_BYTES)),
            )
            .layer(DefaultBodyLimit::max(256 * 1024))
            .with_state(self.inner.clone())
    }
}

impl Inner {
    fn emit(&self, event: ServerEvent) {
        let sink = self.events.read().ok().and_then(|sink| sink.clone());
        if let Some(sink) = sink {
            sink(event);
        }
    }

    fn has_event_sink(&self) -> bool {
        self.events.read().is_ok_and(|sink| sink.is_some())
    }

    /// Changes after `since` to notes from `fingerprint`'s recordings (and to
    /// notes recorded on the Mac, if asked), oldest change first, a page at a
    /// time.
    fn note_changes_for(
        &self,
        fingerprint: &str,
        since: u64,
        include_mac_notes: bool,
    ) -> NoteChangesResponse {
        let Ok(file) = self.notes.lock() else {
            return NoteChangesResponse {
                notes: Vec::new(),
                cursor: since,
                more: false,
            };
        };
        // A cursor from before notes.json was reset: start over.
        let since = if since > file.seq { 0 } else { since };
        let mut mine: Vec<&StoredNote> = file
            .notes
            .values()
            .filter(|stored| {
                stored.seq > since
                    && match &stored.note.recording_id {
                        Some(recording_id) => {
                            self.owner(recording_id).as_deref() == Some(fingerprint)
                        }
                        None => include_mac_notes,
                    }
            })
            .collect();
        mine.sort_by_key(|stored| stored.seq);
        let more = mine.len() > NOTE_CHANGES_PAGE;
        mine.truncate(NOTE_CHANGES_PAGE);
        let cursor = if more {
            mine.last().map_or(since, |stored| stored.seq)
        } else {
            file.seq
        };
        NoteChangesResponse {
            notes: mine.into_iter().map(|stored| stored.note.clone()).collect(),
            cursor,
            more,
        }
    }

    fn is_paired(&self, fingerprint: &str) -> bool {
        self.paired
            .lock()
            .map(|phones| phones.iter().any(|phone| phone.fingerprint == fingerprint))
            .unwrap_or(false)
    }

    fn phone_name(&self, fingerprint: &str) -> String {
        self.paired
            .lock()
            .ok()
            .and_then(|phones| {
                phones
                    .iter()
                    .find(|phone| phone.fingerprint == fingerprint)
                    .map(|phone| phone.name.clone())
            })
            .unwrap_or_else(|| "Phone".into())
    }

    fn touch(&self, fingerprint: &str) {
        let Ok(mut phones) = self.paired.lock() else {
            return;
        };
        let now = now_ms();
        let mut changed = false;
        for phone in phones.iter_mut() {
            if phone.fingerprint == fingerprint
                && phone
                    .last_seen_ms
                    .is_none_or(|seen| now.saturating_sub(seen) > 60_000)
            {
                phone.last_seen_ms = Some(now);
                changed = true;
            }
        }
        if changed {
            let _ = write_json(&self.dir.join("paired.json"), &*phones);
        }
    }

    fn recording_dir(&self, id: &str) -> PathBuf {
        self.dir.join("inbox").join(id)
    }

    fn audio_path(&self, id: &str, ext: &str) -> PathBuf {
        self.recording_dir(id).join(format!("audio.{ext}"))
    }

    fn part_path(&self, id: &str) -> PathBuf {
        self.recording_dir(id).join("audio.part")
    }

    fn owner(&self, id: &str) -> Option<String> {
        std::fs::read_to_string(self.recording_dir(id).join("owner"))
            .ok()
            .map(|owner| owner.trim().to_string())
    }

    fn owned_by(&self, id: &str, fingerprint: &str) -> bool {
        self.owner(id).is_none_or(|owner| owner == fingerprint)
    }

    fn read_meta(&self, id: &str) -> Option<StoredMeta> {
        read_json(&self.recording_dir(id).join("meta.json"))
            .ok()
            .flatten()
    }

    fn read_status(&self, id: &str) -> RecordingStatus {
        let stored = read_json::<RecordingStatus>(&self.recording_dir(id).join("status.json"))
            .ok()
            .flatten();
        let mut status = match stored {
            // A note waiting for its longer recording (see `NoteJob::Extend`)
            // keeps its link to the note; what has arrived is in the part file.
            Some(status)
                if matches!(
                    status.state,
                    RecordingState::Missing | RecordingState::Receiving
                ) =>
            {
                status
            }
            Some(status) => return status,
            None => RecordingStatus::missing(id),
        };
        match std::fs::metadata(self.part_path(id)) {
            Ok(metadata) => {
                status.state = RecordingState::Receiving;
                status.received_bytes = metadata.len();
            }
            Err(_) => {
                status.state = RecordingState::Missing;
                status.received_bytes = 0;
            }
        }
        status
    }

    fn write_status(&self, id: &str, status: &RecordingStatus) -> Result<(), Error> {
        write_json(&self.recording_dir(id).join("status.json"), status)
    }

    fn status_for(&self, id: &str, fingerprint: &str) -> RecordingStatus {
        if !is_valid_recording_id(id) || !self.owned_by(id, fingerprint) {
            return RecordingStatus::missing(id);
        }
        self.read_status(id)
    }
}

fn json_error(status: StatusCode, error: &str) -> Response {
    (
        status,
        Json(ErrorBody {
            error: error.to_string(),
            received_bytes: None,
        }),
    )
        .into_response()
}

fn require_paired(inner: &Inner, peer: &Peer) -> Result<(), Response> {
    if inner.is_paired(&peer.fingerprint) {
        inner.touch(&peer.fingerprint);
        Ok(())
    } else {
        Err(json_error(StatusCode::UNAUTHORIZED, "not_paired"))
    }
}

async fn info(State(inner): State<Arc<Inner>>, Extension(peer): Extension<Peer>) -> Json<MacInfo> {
    let paired = inner.is_paired(&peer.fingerprint);
    if paired {
        inner.touch(&peer.fingerprint);
    }
    Json(MacInfo {
        mac_id: short_id(&inner.fingerprint),
        mac_name: inner
            .mac_name
            .read()
            .map(|name| name.clone())
            .unwrap_or_default(),
        paired,
        version: PROTOCOL_VERSION,
    })
}

async fn pair(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    Json(request): Json<PairRequest>,
) -> Response {
    let accepted = {
        let Ok(mut offer) = inner.offer.lock() else {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock");
        };
        let valid = offer.as_ref().is_some_and(|active| {
            active.expires_at > Instant::now()
                && bool::from(active.code.as_bytes().ct_eq(request.code.trim().as_bytes()))
        });
        if valid {
            // Single use: the code is gone whether or not saving succeeds.
            *offer = None;
        }
        valid
    };
    if !accepted {
        return json_error(StatusCode::FORBIDDEN, "pairing_rejected");
    }

    let name: String = request
        .phone_name
        .trim()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(64)
        .collect();
    let name = if name.is_empty() {
        "Phone".to_string()
    } else {
        name
    };
    {
        let Ok(mut phones) = inner.paired.lock() else {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock");
        };
        phones.retain(|phone| phone.fingerprint != peer.fingerprint);
        phones.push(PairedPhone {
            fingerprint: peer.fingerprint.clone(),
            name: name.clone(),
            paired_at_ms: now_ms(),
            last_seen_ms: Some(now_ms()),
        });
        if let Err(error) = write_json(&inner.dir.join("paired.json"), &*phones) {
            tracing::error!(%error, "could not save paired phones");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
        }
    }
    inner.emit(ServerEvent::PhonePaired {
        name,
        fingerprint: peer.fingerprint,
    });
    Json(PairResponse {
        mac_id: short_id(&inner.fingerprint),
        mac_name: inner
            .mac_name
            .read()
            .map(|name| name.clone())
            .unwrap_or_default(),
    })
    .into_response()
}

async fn recording_status(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    Json(inner.status_for(&id, &peer.fingerprint)).into_response()
}

async fn statuses(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    Json(request): Json<StatusesRequest>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    let statuses: Vec<RecordingStatus> = request
        .ids
        .iter()
        .take(500)
        .map(|id| inner.status_for(id, &peer.fingerprint))
        .collect();
    Json(statuses).into_response()
}

async fn note_changes(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    Json(request): Json<NoteChangesRequest>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    // Ask the Mac app for fresh copies, and give it a moment to publish them.
    let event = ServerEvent::NotesRequested {
        include_mac_notes: request.include_mac_notes,
    };
    let wait = Duration::from_millis(inner.notes_refresh_wait_ms.load(Ordering::Relaxed));
    if inner.has_event_sink() && !wait.is_zero() {
        let published = inner.notes_published.notified();
        tokio::pin!(published);
        published.as_mut().enable();
        inner.emit(event);
        let _ = tokio::time::timeout(wait, published).await;
    } else {
        inner.emit(event);
    }
    Json(inner.note_changes_for(&peer.fingerprint, request.since, request.include_mac_notes))
        .into_response()
}

/// A recording the Mac couldn't turn into a note goes back in the queue.
async fn retry(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    if !is_valid_recording_id(&id) {
        return json_error(StatusCode::BAD_REQUEST, "invalid_id");
    }
    let guard = inner.write_lock.lock().await;
    if !inner.owned_by(&id, &peer.fingerprint) {
        return json_error(StatusCode::FORBIDDEN, "not_yours");
    }
    let mut status = inner.read_status(&id);
    if status.state != RecordingState::Failed {
        return json_error(StatusCode::CONFLICT, "not_failed");
    }
    // A failed job works on the note's own audio, not the inbox copy.
    let has_audio = (status.job.is_some() && status.session_id.is_some())
        || inner
            .read_meta(&id)
            .is_some_and(|stored| inner.audio_path(&id, &stored.meta.ext).exists());
    if !has_audio {
        return json_error(StatusCode::CONFLICT, "no_audio");
    }
    status.state = RecordingState::Queued;
    status.stage = None;
    status.error = None;
    status.updated_at_ms = now_ms();
    if let Err(error) = inner.write_status(&id, &status) {
        tracing::error!(%error, "could not requeue recording");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
    }
    drop(guard);
    inner.emit(ServerEvent::RecordingReceived { id });
    Json(status).into_response()
}

/// The phone asks for more work on a recording: transcribe it again, or cut
/// its end. What happens depends on how far the Mac has got with it:
/// - still arriving: a trim drops what has arrived, so the phone sends the
///   shorter file from the start;
/// - arrived but not yet a note: a trim cuts the waiting file;
/// - a note (or failed): the job is queued for the Mac app.
async fn request_job(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
    Json(job): Json<NoteJob>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    if !is_valid_recording_id(&id) {
        return json_error(StatusCode::BAD_REQUEST, "invalid_id");
    }
    if !job.is_valid() {
        return json_error(StatusCode::BAD_REQUEST, "invalid_job");
    }
    let guard = inner.write_lock.lock().await;
    if !inner.owned_by(&id, &peer.fingerprint) {
        return json_error(StatusCode::FORBIDDEN, "not_yours");
    }
    let mut status = inner.read_status(&id);
    let stored = inner.read_meta(&id);
    let inbox_audio = stored
        .as_ref()
        .map(|stored| inner.audio_path(&id, &stored.meta.ext))
        .filter(|path| path.exists());

    match (status.state, &job) {
        (_, NoteJob::Extend { .. }) => {
            return match extend_recording(&inner, &id, status, inbox_audio, job.clone()) {
                Ok(status) => {
                    drop(guard);
                    Json(status).into_response()
                }
                Err(response) => response,
            };
        }
        (RecordingState::Missing, _) => return json_error(StatusCode::CONFLICT, "no_audio"),
        (RecordingState::Processing, _) => return json_error(StatusCode::CONFLICT, "busy"),
        (RecordingState::Queued, _) if status.job.is_some() => {
            return json_error(StatusCode::CONFLICT, "busy");
        }
        (RecordingState::Receiving, NoteJob::Trim { .. }) => {
            let _ = std::fs::remove_file(inner.part_path(&id));
            drop(guard);
            return Json(inner.read_status(&id)).into_response();
        }
        (RecordingState::Receiving, NoteJob::Retranscribe { .. }) => {
            return json_error(StatusCode::CONFLICT, "not_ready");
        }
        // Not a note yet: the waiting file itself is cut, then processed as usual.
        (RecordingState::Queued | RecordingState::Failed, NoteJob::Trim { keep_ms, .. })
            if inbox_audio.is_some() && status.job.is_none() =>
        {
            let (Some(path), Some(mut stored)) = (inbox_audio, stored) else {
                return json_error(StatusCode::CONFLICT, "no_audio");
            };
            if stored.meta.ext != "wav" {
                return json_error(StatusCode::CONFLICT, "unsupported_audio");
            }
            let keep_ms = *keep_ms;
            let trimmed = tokio::task::spawn_blocking(move || {
                let trimmed = crate::trim_wav_file(&path, keep_ms)?;
                let sha256 = crate::sha256_file(&path)?;
                let size = std::fs::metadata(&path)?.len();
                Ok::<_, std::io::Error>((trimmed, sha256, size))
            })
            .await;
            let Ok(Ok((trimmed, sha256, size))) = trimmed else {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, "trim_failed");
            };
            stored.meta.duration_ms = Some(trimmed.duration_ms);
            stored.size = size;
            stored.sha256 = sha256;
            status.state = RecordingState::Queued;
            status.received_bytes = size;
            status.stage = None;
            status.error = None;
            status.updated_at_ms = now_ms();
            let saved = (|| -> Result<(), Error> {
                write_json(&inner.recording_dir(&id).join("meta.json"), &stored)?;
                inner.write_status(&id, &status)
            })();
            drop(guard);
            if let Err(error) = saved {
                tracing::error!(%error, "could not save trimmed recording");
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
            }
            inner.emit(ServerEvent::RecordingReceived { id });
            return Json(status).into_response();
        }
        (RecordingState::Queued, NoteJob::Retranscribe { .. }) => {
            // It hasn't been transcribed yet; it will be.
            drop(guard);
            return Json(status).into_response();
        }
        (RecordingState::Failed, NoteJob::Retranscribe { .. })
            if inbox_audio.is_some() && status.job.is_none() =>
        {
            // Same as Try again: the first attempt never became a note.
            status.state = RecordingState::Queued;
        }
        (RecordingState::Done | RecordingState::Failed, _) => {
            if status.session_id.is_none() {
                return json_error(StatusCode::CONFLICT, "not_ready");
            }
            status.state = RecordingState::Queued;
            status.job = Some(job);
        }
        (RecordingState::Queued, NoteJob::Trim { .. }) => {
            return json_error(StatusCode::CONFLICT, "no_audio");
        }
    }
    status.stage = None;
    status.error = None;
    status.updated_at_ms = now_ms();
    if let Err(error) = inner.write_status(&id, &status) {
        tracing::error!(%error, "could not queue the note job");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
    }
    drop(guard);
    inner.emit(ServerEvent::RecordingReceived { id });
    Json(status).into_response()
}

/// More was recorded on the phone: whatever the Mac has of the shorter
/// recording goes, and the phone sends the longer file from the start. A note
/// the Mac already made stays linked to it, with an Extend job, so it is made
/// again instead of a second note. Asking twice changes nothing.
fn extend_recording(
    inner: &Inner,
    id: &str,
    status: RecordingStatus,
    inbox_audio: Option<PathBuf>,
    job: NoteJob,
) -> Result<RecordingStatus, Response> {
    match status.state {
        RecordingState::Processing => return Err(json_error(StatusCode::CONFLICT, "busy")),
        RecordingState::Queued if status.job.is_some() => {
            return Err(json_error(StatusCode::CONFLICT, "busy"));
        }
        RecordingState::Missing => return Ok(status),
        _ => {}
    }
    let _ = std::fs::remove_file(inner.part_path(id));
    if let Some(path) = inbox_audio {
        let _ = std::fs::remove_file(path);
    }
    let waiting = RecordingStatus {
        state: RecordingState::Missing,
        received_bytes: 0,
        job: status.session_id.is_some().then_some(job),
        session_id: status.session_id,
        updated_at_ms: now_ms(),
        ..RecordingStatus::missing(id)
    };
    if let Err(error) = inner.write_status(id, &waiting) {
        tracing::error!(%error, "could not make room for the longer recording");
        return Err(json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed"));
    }
    Ok(waiting)
}

/// Keeps the phone's problem log (it sends the whole log each time).
async fn receive_diagnostics(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    body: Bytes,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    let dir = inner.dir.join("diagnostics");
    let path = dir.join(format!("{}.log", short_id(&peer.fingerprint)));
    let header = format!(
        "# phone: {}\n# received: {}\n",
        inner.phone_name(&peer.fingerprint),
        now_ms()
    );
    let result = async {
        tokio::fs::create_dir_all(&dir).await?;
        let temp = path.with_extension("log.tmp");
        let mut file = tokio::fs::File::create(&temp).await?;
        file.write_all(header.as_bytes()).await?;
        file.write_all(&body).await?;
        file.flush().await?;
        drop(file);
        tokio::fs::rename(&temp, &path).await
    }
    .await;
    match result {
        Ok(()) => Json(serde_json::json!({ "received_bytes": body.len() })).into_response(),
        Err(error) => {
            tracing::error!(%error, "could not store the phone's log");
            json_error(StatusCode::INSUFFICIENT_STORAGE, "write_failed")
        }
    }
}

#[derive(Deserialize)]
struct OffsetQuery {
    offset: u64,
}

async fn upload_chunk(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
    Query(query): Query<OffsetQuery>,
    body: Bytes,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    if !is_valid_recording_id(&id) {
        return json_error(StatusCode::BAD_REQUEST, "invalid_id");
    }
    let _guard = inner.write_lock.lock().await;
    if !inner.owned_by(&id, &peer.fingerprint) {
        return json_error(StatusCode::FORBIDDEN, "not_yours");
    }
    let status = inner.read_status(&id);
    if !matches!(
        status.state,
        RecordingState::Missing | RecordingState::Receiving
    ) {
        return json_error(StatusCode::CONFLICT, "already_received");
    }
    if status.received_bytes != query.offset {
        return (
            StatusCode::CONFLICT,
            Json(ErrorBody {
                error: "offset_mismatch".into(),
                received_bytes: Some(status.received_bytes),
            }),
        )
            .into_response();
    }
    if query.offset + body.len() as u64 > MAX_RECORDING_BYTES {
        return json_error(StatusCode::PAYLOAD_TOO_LARGE, "too_large");
    }

    let result = async {
        let dir = inner.recording_dir(&id);
        tokio::fs::create_dir_all(&dir).await?;
        let owner = dir.join("owner");
        if tokio::fs::metadata(&owner).await.is_err() {
            tokio::fs::write(&owner, &peer.fingerprint).await?;
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(inner.part_path(&id))
            .await?;
        file.write_all(&body).await?;
        file.flush().await?;
        file.sync_data().await?;
        Ok::<u64, std::io::Error>(query.offset + body.len() as u64)
    }
    .await;

    match result {
        Ok(received_bytes) => Json(ChunkResponse { received_bytes }).into_response(),
        Err(error) => {
            tracing::error!(%error, "could not store recording chunk");
            json_error(StatusCode::INSUFFICIENT_STORAGE, "write_failed")
        }
    }
}

async fn complete(
    State(inner): State<Arc<Inner>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
    Json(request): Json<CompleteRequest>,
) -> Response {
    if let Err(response) = require_paired(&inner, &peer) {
        return response;
    }
    if !is_valid_recording_id(&id) {
        return json_error(StatusCode::BAD_REQUEST, "invalid_id");
    }
    let ext = request
        .meta
        .ext
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        return json_error(StatusCode::BAD_REQUEST, "unsupported_audio");
    }

    let guard = inner.write_lock.lock().await;
    if !inner.owned_by(&id, &peer.fingerprint) {
        return json_error(StatusCode::FORBIDDEN, "not_yours");
    }
    let status = inner.read_status(&id);
    match status.state {
        RecordingState::Missing => return json_error(StatusCode::CONFLICT, "no_audio"),
        RecordingState::Receiving => {}
        _ => return Json(status).into_response(),
    }
    if status.received_bytes != request.size {
        return (
            StatusCode::CONFLICT,
            Json(ErrorBody {
                error: "offset_mismatch".into(),
                received_bytes: Some(status.received_bytes),
            }),
        )
            .into_response();
    }

    let part = inner.part_path(&id);
    let digest = match tokio::task::spawn_blocking(move || crate::sha256_file(&part)).await {
        Ok(Ok(digest)) => digest,
        _ => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "read_failed"),
    };
    if !bool::from(
        digest
            .as_bytes()
            .ct_eq(request.sha256.trim().to_ascii_lowercase().as_bytes()),
    ) {
        // Start over rather than keep a damaged file.
        let _ = tokio::fs::remove_file(inner.part_path(&id)).await;
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, "checksum_mismatch");
    }

    let mut meta = request.meta;
    meta.ext = ext.clone();
    meta.title = meta
        .title
        .map(|title| title.chars().take(300).collect::<String>())
        .filter(|title| !title.trim().is_empty());
    meta.notes_md = meta
        .notes_md
        .map(|notes| notes.chars().take(200_000).collect::<String>())
        .filter(|notes| !notes.trim().is_empty());
    let stored = StoredMeta {
        meta,
        phone_fingerprint: peer.fingerprint.clone(),
        phone_name: inner.phone_name(&peer.fingerprint),
        received_at_ms: now_ms(),
        size: request.size,
        sha256: digest,
    };
    // A longer recording for a note the Mac made keeps that note and the
    // Extend job, so the note is made again rather than a new one.
    let (session_id, job) = match status.job {
        Some(job @ NoteJob::Extend { .. }) if status.session_id.is_some() => {
            (status.session_id.clone(), Some(job))
        }
        _ => (None, None),
    };
    let queued = RecordingStatus {
        state: RecordingState::Queued,
        received_bytes: request.size,
        updated_at_ms: now_ms(),
        session_id,
        job,
        ..RecordingStatus::missing(&id)
    };
    let saved = (|| -> Result<(), Error> {
        write_json(&inner.recording_dir(&id).join("meta.json"), &stored)?;
        std::fs::rename(inner.part_path(&id), inner.audio_path(&id, &ext))?;
        inner.write_status(&id, &queued)?;
        Ok(())
    })();
    drop(guard);
    if let Err(error) = saved {
        tracing::error!(%error, "could not finish recording");
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
    }

    inner.emit(ServerEvent::RecordingReceived { id });
    Json(queued).into_response()
}

fn load_or_create_identity(path: &Path) -> Result<Identity, Error> {
    if let Some(identity) = read_json::<Identity>(path)? {
        identity.validate()?;
        return Ok(identity);
    }
    let identity = Identity::generate()?;
    // Create the key file private from the start, then move it into place.
    let temp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&temp);
    write_private(&temp, &serde_json::to_vec_pretty(&identity)?)?;
    std::fs::rename(&temp, path)?;
    Ok(identity)
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, Error> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Writes through a temporary file so a crash never leaves half a file.
fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), Error> {
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}
