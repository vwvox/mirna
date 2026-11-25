#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum TrayRecordingActionKind {
    Pause,
    Resume,
    Stop,
}

/// Asked from the menu bar; the main window acts on the recording it owns.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, tauri_specta::Event)]
pub struct TrayRecordingAction {
    pub action: TrayRecordingActionKind,
}
