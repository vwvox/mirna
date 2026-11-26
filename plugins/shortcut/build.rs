const COMMANDS: &[&str] = &[
    "register_hotkey",
    "unregister_hotkey",
    "configure",
    "configure_gestures",
    "validate",
    "set_active",
    "register_mark_shortcuts",
    "unregister_mark_shortcuts",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
