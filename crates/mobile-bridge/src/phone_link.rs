//! Pairing with the Mac and sending recordings to it, over the local network.
//!
//! Every call takes and returns JSON so the TypeScript side stays small. The
//! phone's identity (certificate and private key) lives in the app's secure
//! store and is passed in on each call; nothing here keeps state between
//! calls.

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use anlg_phone_link::client::{Client, MacTarget};
use anlg_phone_link::protocol::{CompleteRequest, RecordingMeta};
use anlg_phone_link::{Identity, MAX_CHUNK_BYTES, PairingOffer};
use bytes::Bytes;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum PhoneLinkError {
    /// `code` is stable for the app to branch on; `message` is for logs.
    #[error("{code}: {message}")]
    Failed { code: String, message: String },
}

impl From<anlg_phone_link::Error> for PhoneLinkError {
    fn from(error: anlg_phone_link::Error) -> Self {
        Self::Failed {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }
}

fn invalid(message: impl Into<String>) -> PhoneLinkError {
    PhoneLinkError::Failed {
        code: "invalid_request".into(),
        message: message.into(),
    }
}

fn io_error(error: impl std::fmt::Display) -> PhoneLinkError {
    PhoneLinkError::Failed {
        code: "io".into(),
        message: error.to_string(),
    }
}

fn to_json<T: Serialize>(value: &T) -> Result<String, PhoneLinkError> {
    serde_json::to_string(value).map_err(|error| invalid(error.to_string()))
}

fn from_json<T: for<'de> Deserialize<'de>>(json: &str) -> Result<T, PhoneLinkError> {
    serde_json::from_str(json).map_err(|error| invalid(error.to_string()))
}

/// Accepts a `file://` URI or a plain path.
fn local_path(value: &str) -> Result<PathBuf, PhoneLinkError> {
    if value.starts_with("file:") {
        url::Url::parse(value)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .ok_or_else(|| invalid("bad file uri"))
    } else {
        Ok(PathBuf::from(value))
    }
}

#[derive(Deserialize)]
struct Connection {
    identity: Identity,
    mac: MacTarget,
}

impl Connection {
    fn client(self) -> Result<Client, PhoneLinkError> {
        Ok(Client::new(&self.identity, self.mac)?)
    }
}

#[derive(Serialize)]
struct NewIdentity {
    cert_pem: String,
    key_pem: String,
    fingerprint: String,
}

/// Makes this phone's long-lived identity. Called once, before first pairing.
#[uniffi::export]
pub fn phone_link_new_identity() -> Result<String, PhoneLinkError> {
    let identity = Identity::generate()?;
    let fingerprint = identity.fingerprint()?;
    to_json(&NewIdentity {
        cert_pem: identity.cert_pem,
        key_pem: identity.key_pem,
        fingerprint,
    })
}

/// Reads the text of a scanned QR code.
#[uniffi::export]
pub fn phone_link_parse_offer(uri: String) -> Result<String, PhoneLinkError> {
    to_json(&PairingOffer::parse(&uri)?)
}

#[derive(Deserialize)]
struct PairRequest {
    identity: Identity,
    offer: PairingOffer,
    phone_name: String,
}

#[derive(Serialize)]
struct PairReply {
    mac_id: String,
    mac_name: String,
    working_host: Option<String>,
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_pair(request_json: String) -> Result<String, PhoneLinkError> {
    let request: PairRequest = from_json(&request_json)?;
    let client = Client::new(
        &request.identity,
        MacTarget {
            hosts: request.offer.addresses.clone(),
            port: request.offer.port,
            fingerprint: request.offer.fingerprint.clone(),
        },
    )?;
    let reply = client
        .pair(&request.offer.code, &request.phone_name)
        .await?;
    to_json(&PairReply {
        mac_id: reply.mac_id,
        mac_name: reply.mac_name,
        working_host: client.working_host(),
    })
}

#[derive(Serialize)]
struct InfoReply {
    mac_id: String,
    mac_name: String,
    paired: bool,
    working_host: Option<String>,
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_info(request_json: String) -> Result<String, PhoneLinkError> {
    let client = from_json::<Connection>(&request_json)?.client()?;
    let info = client.info().await?;
    to_json(&InfoReply {
        mac_id: info.mac_id,
        mac_name: info.mac_name,
        paired: info.paired,
        working_host: client.working_host(),
    })
}

#[derive(Deserialize)]
struct StatusesRequest {
    #[serde(flatten)]
    connection: Connection,
    ids: Vec<String>,
}

#[derive(Serialize)]
struct StatusesReply {
    statuses: Vec<anlg_phone_link::protocol::RecordingStatus>,
    working_host: Option<String>,
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_statuses(request_json: String) -> Result<String, PhoneLinkError> {
    let request: StatusesRequest = from_json(&request_json)?;
    let client = request.connection.client()?;
    let statuses = client.statuses(&request.ids).await?;
    to_json(&StatusesReply {
        statuses,
        working_host: client.working_host(),
    })
}

#[derive(Deserialize)]
struct SendRequest {
    #[serde(flatten)]
    connection: Connection,
    recording_id: String,
    file: String,
    /// Where the Mac's copy currently ends.
    offset: u64,
    /// How many chunks to send in this call before returning, so the app can
    /// show progress between calls.
    #[serde(default = "default_chunks")]
    chunks: u32,
}

fn default_chunks() -> u32 {
    1
}

#[derive(Serialize)]
struct SendReply {
    received_bytes: u64,
    total_bytes: u64,
    working_host: Option<String>,
}

const CHUNK_BYTES: usize = 4 * 1024 * 1024;

#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_send(request_json: String) -> Result<String, PhoneLinkError> {
    let request: SendRequest = from_json(&request_json)?;
    let path = local_path(&request.file)?;
    let total_bytes = std::fs::metadata(&path).map_err(io_error)?.len();
    let client = request.connection.client()?;
    let mut offset = request.offset.min(total_bytes);
    for _ in 0..request.chunks.max(1) {
        if offset >= total_bytes {
            break;
        }
        let data = read_chunk(path.clone(), offset, CHUNK_BYTES.min(MAX_CHUNK_BYTES)).await?;
        if data.is_empty() {
            break;
        }
        offset = match client
            .upload_chunk(&request.recording_id, offset, data)
            .await
        {
            Ok(received) => received,
            // The Mac already has more or less than we thought: carry on from
            // where it is.
            Err(anlg_phone_link::Error::OffsetMismatch { received_bytes }) => received_bytes,
            Err(error) => return Err(error.into()),
        };
    }
    to_json(&SendReply {
        received_bytes: offset,
        total_bytes,
        working_host: client.working_host(),
    })
}

async fn read_chunk(path: PathBuf, offset: u64, max: usize) -> Result<Bytes, PhoneLinkError> {
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut buffer = Vec::with_capacity(max);
        file.take(max as u64).read_to_end(&mut buffer)?;
        Ok::<_, std::io::Error>(Bytes::from(buffer))
    })
    .await
    .map_err(io_error)?
    .map_err(io_error)
}

#[derive(Deserialize)]
struct NoteChangesCall {
    #[serde(flatten)]
    connection: Connection,
    #[serde(default)]
    since: u64,
    #[serde(default)]
    include_mac_notes: bool,
}

#[derive(Serialize)]
struct NoteChangesReply {
    notes: Vec<anlg_phone_link::protocol::NoteSnapshot>,
    cursor: u64,
    more: bool,
    working_host: Option<String>,
}

/// The text of this phone's notes that changed on the Mac since `since`
/// (titles, summaries and transcripts; never audio).
#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_note_changes(request_json: String) -> Result<String, PhoneLinkError> {
    let request: NoteChangesCall = from_json(&request_json)?;
    let client = request.connection.client()?;
    let changes = client
        .note_changes(request.since, request.include_mac_notes)
        .await?;
    to_json(&NoteChangesReply {
        notes: changes.notes,
        cursor: changes.cursor,
        more: changes.more,
        working_host: client.working_host(),
    })
}

#[derive(Deserialize)]
struct RetryCall {
    #[serde(flatten)]
    connection: Connection,
    recording_id: String,
}

#[derive(Serialize)]
struct RetryReply {
    status: anlg_phone_link::protocol::RecordingStatus,
    working_host: Option<String>,
}

/// Asks the Mac to try a recording it couldn't turn into a note again.
#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_retry(request_json: String) -> Result<String, PhoneLinkError> {
    let request: RetryCall = from_json(&request_json)?;
    let client = request.connection.client()?;
    let status = client.retry(&request.recording_id).await?;
    to_json(&RetryReply {
        status,
        working_host: client.working_host(),
    })
}

#[derive(Deserialize)]
struct CompleteCall {
    #[serde(flatten)]
    connection: Connection,
    recording_id: String,
    file: String,
    meta: RecordingMeta,
}

#[derive(Serialize)]
struct CompleteReply {
    status: anlg_phone_link::protocol::RecordingStatus,
    working_host: Option<String>,
}

/// Tells the Mac the whole file has been sent, with its size and checksum.
#[uniffi::export(async_runtime = "tokio")]
pub async fn phone_link_complete(request_json: String) -> Result<String, PhoneLinkError> {
    let request: CompleteCall = from_json(&request_json)?;
    let path = local_path(&request.file)?;
    let size = std::fs::metadata(&path).map_err(io_error)?.len();
    let sha256 = tokio::task::spawn_blocking(move || anlg_phone_link::sha256_file(&path))
        .await
        .map_err(io_error)?
        .map_err(io_error)?;
    let client = request.connection.client()?;
    let status = client
        .complete(
            &request.recording_id,
            &CompleteRequest {
                size,
                sha256,
                meta: request.meta,
            },
        )
        .await?;
    to_json(&CompleteReply {
        status,
        working_host: client.working_host(),
    })
}
