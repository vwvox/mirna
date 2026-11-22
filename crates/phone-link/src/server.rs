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
//! ```

use std::future::Future;
use std::path::{Path, PathBuf};
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
use subtle::ConstantTimeEq;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

use crate::protocol::{
    ChunkResponse, CompleteRequest, ErrorBody, MacInfo, PairRequest, PairResponse, RecordingMeta,
    RecordingState, RecordingStatus, StatusesRequest, is_valid_recording_id,
};
use crate::{
    AUDIO_EXTENSIONS, Error, Identity, MAX_CHUNK_BYTES, MAX_RECORDING_BYTES, PROTOCOL_VERSION,
    PairingOffer, fingerprint_of_der, now_ms, short_id,
};

const TLS_ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
const PAIRING_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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
    PhonePaired { name: String, fingerprint: String },
    RecordingReceived { id: String },
}

/// A complete recording waiting for, or in, processing on the Mac.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub audio_path: PathBuf,
    pub meta: RecordingMeta,
    pub phone_name: String,
    pub received_at_ms: u64,
    pub status: RecordingStatus,
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
            }),
        })
    }

    pub fn fingerprint(&self) -> String {
        self.inner.fingerprint.clone()
    }

    pub fn mac_id(&self) -> String {
        short_id(&self.inner.fingerprint)
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
            if !audio_path.exists() {
                continue;
            }
            items.push(InboxItem {
                id,
                audio_path,
                meta: stored.meta,
                phone_name: stored.phone_name,
                received_at_ms: stored.received_at_ms,
                status,
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
        if let Some(status) =
            read_json::<RecordingStatus>(&self.recording_dir(id).join("status.json"))
                .ok()
                .flatten()
        {
            return status;
        }
        match std::fs::metadata(self.part_path(id)) {
            Ok(metadata) => RecordingStatus {
                state: RecordingState::Receiving,
                received_bytes: metadata.len(),
                ..RecordingStatus::missing(id)
            },
            Err(_) => RecordingStatus::missing(id),
        }
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
    let queued = RecordingStatus {
        state: RecordingState::Queued,
        received_bytes: request.size,
        updated_at_ms: now_ms(),
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
