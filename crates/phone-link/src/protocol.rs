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

/// One recording's transcript, in the stored format both apps share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteTranscript {
    pub id: String,
    /// When that recording started (Unix ms). The phone uses it to tell its
    /// own recording from ones added later on the Mac.
    pub started_at_ms: i64,
    #[serde(default)]
    pub ended_at_ms: Option<i64>,
    #[serde(default)]
    pub memo: String,
    pub words_json: String,
    #[serde(default = "empty_json_array")]
    pub speaker_hints_json: String,
}

fn empty_json_array() -> String {
    "[]".into()
}

/// The text of a note as it is now on the Mac: one that began as a phone
/// recording, or (when the phone asks for them) one recorded on the Mac.
/// Audio never goes to the phone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteSnapshot {
    /// The phone's id for the recording it sent, or none for a note that was
    /// recorded on the Mac.
    #[serde(default)]
    pub recording_id: Option<String>,
    /// The Mac's id for the note.
    pub session_id: String,
    pub title: String,
    #[serde(default)]
    pub summary_md: Option<String>,
    #[serde(default)]
    pub transcripts: Vec<NoteTranscript>,
    /// When the note was made (RFC 3339), for notes recorded on the Mac.
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteChangesRequest {
    /// The `cursor` from the last answer, or 0 the first time.
    #[serde(default)]
    pub since: u64,
    /// Also send notes recorded on the Mac (text only).
    #[serde(default)]
    pub include_mac_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteChangesResponse {
    pub notes: Vec<NoteSnapshot>,
    /// Send back as `since` next time.
    pub cursor: u64,
    /// More changes are waiting: ask again with the new cursor.
    #[serde(default)]
    pub more: bool,
}

/// Recording ids are the phone's session UUIDs. Anything else is refused so an
/// id can never escape the inbox folder.
pub fn is_valid_recording_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}
