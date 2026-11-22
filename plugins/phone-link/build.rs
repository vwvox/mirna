const COMMANDS: &[&str] = &[
    "get_status",
    "start_pairing",
    "cancel_pairing",
    "list_phones",
    "remove_phone",
    "list_inbox",
    "update_recording",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
