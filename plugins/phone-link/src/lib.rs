mod commands;
mod runner;

use std::sync::Arc;

use anlg_phone_link::server::{PhoneLinkServer, ServerEvent};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_specta::Event;

const PLUGIN_NAME: &str = "phone-link";

pub struct PhoneLinkState {
    pub(crate) server: Option<PhoneLinkServer>,
    pub(crate) open_error: Option<String>,
    pub(crate) running: tokio::sync::Mutex<Option<runner::Running>>,
    pub(crate) last_error: std::sync::Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(tag = "type")]
pub enum PhoneLinkEvent {
    #[serde(rename = "phonePaired")]
    PhonePaired { name: String },
    #[serde(rename = "recordingReceived")]
    RecordingReceived { id: String },
    /// A phone asked what changed: publish fresh copies of its notes, and of
    /// notes recorded on this Mac when `include_mac_notes` is set.
    #[serde(rename = "notesRequested")]
    NotesRequested { include_mac_notes: bool },
}

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::get_status::<tauri::Wry>,
            commands::start_pairing::<tauri::Wry>,
            commands::cancel_pairing::<tauri::Wry>,
            commands::list_phones::<tauri::Wry>,
            commands::remove_phone::<tauri::Wry>,
            commands::list_inbox::<tauri::Wry>,
            commands::update_recording::<tauri::Wry>,
            commands::list_linked_notes::<tauri::Wry>,
            commands::publish_notes::<tauri::Wry>,
            commands::export_logs::<tauri::Wry>,
        ])
        .events(tauri_specta::collect_events![PhoneLinkEvent])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            specta_builder.mount_events(app);

            let opened = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())
                .and_then(|dir| {
                    PhoneLinkServer::open(dir.join("phone-link"), mac_name())
                        .map_err(|error| error.to_string())
                });
            let (server, open_error) = match opened {
                Ok(server) => (Some(server), None),
                Err(error) => {
                    tracing::error!(%error, "phone link unavailable");
                    (None, Some(error))
                }
            };

            if let Some(server) = &server {
                let handle = app.app_handle().clone();
                server.set_event_sink(move |event| {
                    let event = match event {
                        ServerEvent::PhonePaired { name, .. } => {
                            PhoneLinkEvent::PhonePaired { name }
                        }
                        ServerEvent::RecordingReceived { id } => {
                            PhoneLinkEvent::RecordingReceived { id }
                        }
                        ServerEvent::NotesRequested { include_mac_notes } => {
                            PhoneLinkEvent::NotesRequested { include_mac_notes }
                        }
                    };
                    let _ = event.emit(&handle);
                });
            }

            let has_phones = server
                .as_ref()
                .is_some_and(|server| !server.paired_phones().is_empty());
            app.manage(Arc::new(PhoneLinkState {
                server,
                open_error,
                running: tokio::sync::Mutex::new(None),
                last_error: std::sync::Mutex::new(None),
            }));

            if has_phones {
                let state = app.state::<Arc<PhoneLinkState>>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    commands::ensure_running(&state).await;
                });
            }
            Ok(())
        })
        .build()
}

/// The name people gave this Mac (System Settings › General › About).
fn mac_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("/usr/sbin/scutil")
            .args(["--get", "ComputerName"])
            .output()
        {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && !name.is_empty() {
                return name;
            }
        }
    }
    "Mac".to_string()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "./js/bindings.gen.ts";

        make_specta_builder::<tauri::Wry>()
            .export(
                specta_typescript::Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                OUTPUT_FILE,
            )
            .unwrap();

        let content = std::fs::read_to_string(OUTPUT_FILE).unwrap();
        std::fs::write(OUTPUT_FILE, format!("// @ts-nocheck\n{content}")).unwrap();
    }

    #[test]
    fn lists_only_reachable_addresses() {
        let addresses = runner::local_addresses();
        assert!(addresses.iter().all(|address| !address.starts_with("127.")));
    }
}
