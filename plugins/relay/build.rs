const COMMANDS: &[&str] = &["relay_result", "relay_channel"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
