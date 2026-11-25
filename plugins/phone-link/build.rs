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
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
