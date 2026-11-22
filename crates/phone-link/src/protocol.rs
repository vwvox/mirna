use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacInfo {
    pub mac_id: String,
    pub mac_name: String,
    /// Whether the asking phone is paired with this Mac.
    pub paired: bool,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairRequest {
    pub code: String,
    pub phone_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairResponse {
    pub mac_id: String,
    pub mac_name: String,
}

/// What the phone knows about a recording, sent once the audio is complete.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordingMeta {
    #[serde(default)]
    pub title: Option<String>,
    /// When recording started, RFC 3339.
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// Audio file extension without the dot, for example `wav`.
    pub ext: String,
    /// Notes typed on the phone during the recording, as Markdown.
    #[serde(default)]
    pub notes_md: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteRequest {
    pub size: u64,
    /// Lowercase hex SHA-256 of the whole file.
    pub sha256: String,
    pub meta: RecordingMeta,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingState {
    /// The Mac has nothing for this recording.
    Missing,
    /// Part of the audio has arrived.
    Receiving,
    /// All audio arrived; waiting its turn.
    Queued,
    /// Being turned into a note (see `stage`).
    Processing,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub id: String,
    pub state: RecordingState,
    pub received_bytes: u64,
    /// `importing`, `transcribing` or `summarizing` while processing.
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary_md: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub updated_at_ms: u64,
}

impl RecordingStatus {
    pub fn missing(id: &str) -> Self {
        Self {
            id: id.to_string(),
            state: RecordingState::Missing,
            received_bytes: 0,
            stage: None,
            session_id: None,
            title: None,
            summary_md: None,
            error: None,
            updated_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusesRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkResponse {
    pub received_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorBody {
    pub error: String,
    #[serde(default)]
    pub received_bytes: Option<u64>,
}

/// Recording ids are the phone's session UUIDs. Anything else is refused so an
/// id can never escape the inbox folder.
pub fn is_valid_recording_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}
