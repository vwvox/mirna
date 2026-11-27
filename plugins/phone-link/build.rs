const COMMANDS: &[&str] = &[
    "get_status",
    "start_pairing",
    "cancel_pairing",
    "list_phones",
    "remove_phone",
    "list_inbox",
    "update_recording",
    "list_linked_notes",
    "publish_notes",
    "export_logs",
    "publish_courses",
    "export_clips",
    "list_reviews",
    "remove_review",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
