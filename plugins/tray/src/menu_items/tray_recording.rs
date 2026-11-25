use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};
use tauri_specta::Event;

use super::MenuItemHandler;
use crate::{TrayRecordingAction, TrayRecordingActionKind};

pub struct TrayPauseRecording;

impl MenuItemHandler for TrayPauseRecording {
    const ID: &'static str = "anlg_tray_pause_recording";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        Ok(MenuItemKind::MenuItem(Self::build_with_paused(
            app,
            crate::ext::recording_paused(),
        )?))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        let action = if crate::ext::recording_paused() {
            TrayRecordingActionKind::Resume
        } else {
            TrayRecordingActionKind::Pause
        };
        let _ = TrayRecordingAction { action }.emit(app);
    }
}

impl TrayPauseRecording {
    pub fn build_with_paused(
        app: &AppHandle<tauri::Wry>,
        paused: bool,
    ) -> Result<MenuItem<tauri::Wry>> {
        MenuItem::with_id(app, Self::ID, pause_label(paused), true, None::<&str>)
    }
}

pub struct TrayStopRecording;

impl MenuItemHandler for TrayStopRecording {
    const ID: &'static str = "anlg_tray_stop_recording";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(app, Self::ID, "Stop recording", true, None::<&str>)?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        let _ = TrayRecordingAction {
            action: TrayRecordingActionKind::Stop,
        }
        .emit(app);
    }
}

fn pause_label(paused: bool) -> &'static str {
    if paused {
        "Resume recording"
    } else {
        "Pause recording"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pause_item_offers_the_opposite_of_the_current_state() {
        assert_eq!(pause_label(false), "Pause recording");
        assert_eq!(pause_label(true), "Resume recording");
    }

    #[test]
    fn menu_ids_route_back_to_the_recording_items() {
        use crate::AnlgMenuItem;

        assert!(matches!(
            AnlgMenuItem::try_from(tauri::menu::MenuId::new(TrayPauseRecording::ID)),
            Ok(AnlgMenuItem::TrayPauseRecording)
        ));
        assert!(matches!(
            AnlgMenuItem::try_from(tauri::menu::MenuId::new(TrayStopRecording::ID)),
            Ok(AnlgMenuItem::TrayStopRecording)
        ));
    }
}
