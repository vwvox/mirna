use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};
use tauri_specta::Event;

use crate::MarkShortcut;

type GlobalShortcut = tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>;

/// Lesson mark shortcuts, kept apart from the dictation shortcut so either can change alone.
#[derive(Default)]
pub struct MarkState {
    registered: tokio::sync::Mutex<Vec<Shortcut>>,
}

/// Registers `shortcuts` in place of the previous mark shortcuts. Pressing the shortcut at
/// position `i` emits `MarkShortcut { index: i }`. An invalid or taken shortcut leaves the
/// previous set registered; a failure while registering leaves none.
#[tauri::command]
#[specta::specta]
pub async fn register_mark_shortcuts(
    app: tauri::AppHandle,
    shortcuts: Vec<String>,
) -> Result<(), String> {
    let next = parse_mark_shortcuts(&shortcuts)?;
    let state = app.state::<MarkState>();
    let mut registered = state.registered.lock().await;
    if crate::global::uses_portal() {
        return Err("Mark shortcuts are unavailable on this Wayland desktop.".into());
    }
    let Some(global) = app.try_state::<GlobalShortcut>() else {
        return Err("Global shortcuts are unavailable in this desktop session.".into());
    };
    replace(&mut GlobalRegistrar(&global), &mut registered, next)
}

#[tauri::command]
#[specta::specta]
pub async fn unregister_mark_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<MarkState>();
    let mut registered = state.registered.lock().await;
    match app.try_state::<GlobalShortcut>() {
        Some(global) => clear(&mut GlobalRegistrar(&global), &mut registered),
        None => {
            registered.clear();
            Ok(())
        }
    }
}

pub(crate) trait Registrar {
    /// Whether something other than the mark shortcuts already holds `key`.
    fn is_taken(&self, key: Shortcut) -> bool;
    fn register(&mut self, key: Shortcut, index: u32) -> Result<(), String>;
    fn unregister(&mut self, key: Shortcut) -> Result<(), String>;
}

struct GlobalRegistrar<'a>(&'a GlobalShortcut);

impl Registrar for GlobalRegistrar<'_> {
    fn is_taken(&self, key: Shortcut) -> bool {
        self.0.is_registered(key)
    }

    fn register(&mut self, key: Shortcut, index: u32) -> Result<(), String> {
        self.0
            .on_shortcut(key, move |app, _, event| {
                if let Some(event) = mark_event(index, event.state) {
                    let _ = event.emit(app);
                }
            })
            .map_err(|e| format!("Could not register {key}. It may be used by another app: {e}"))
    }

    fn unregister(&mut self, key: Shortcut) -> Result<(), String> {
        self.0.unregister(key).map_err(|e| e.to_string())
    }
}

pub(crate) fn mark_event(index: u32, state: ShortcutState) -> Option<MarkShortcut> {
    (state == ShortcutState::Pressed).then_some(MarkShortcut { index })
}

pub(crate) fn parse_mark_shortcuts(shortcuts: &[String]) -> Result<Vec<Shortcut>, String> {
    let mut keys: Vec<Shortcut> = Vec::with_capacity(shortcuts.len());
    for shortcut in shortcuts {
        let key: Shortcut = shortcut
            .parse()
            .map_err(|e| format!("Invalid mark shortcut \"{shortcut}\": {e}"))?;
        // Without a modifier the key would stop typing in every other app while recording.
        if key.mods.is_empty() {
            return Err(format!(
                "Mark shortcut \"{shortcut}\" needs Control, Alt, Shift, or Command."
            ));
        }
        if key.key == Code::Escape {
            return Err("Escape is reserved for cancelling dictation.".into());
        }
        if keys.contains(&key) {
            return Err(format!("Mark shortcut \"{shortcut}\" is listed twice."));
        }
        keys.push(key);
    }
    Ok(keys)
}

pub(crate) fn replace<R: Registrar>(
    registrar: &mut R,
    current: &mut Vec<Shortcut>,
    next: Vec<Shortcut>,
) -> Result<(), String> {
    if let Some(key) = next
        .iter()
        .find(|key| !current.contains(key) && registrar.is_taken(**key))
    {
        return Err(format!("{key} is already used by another Mirna shortcut."));
    }
    clear(registrar, current)?;
    for (index, key) in next.into_iter().enumerate() {
        if let Err(error) = registrar.register(key, index as u32) {
            if let Err(rollback) = clear(registrar, current) {
                tracing::warn!(%rollback, "Could not roll back mark shortcuts");
            }
            return Err(error);
        }
        current.push(key);
    }
    Ok(())
}

pub(crate) fn clear<R: Registrar>(
    registrar: &mut R,
    current: &mut Vec<Shortcut>,
) -> Result<(), String> {
    while let Some(key) = current.last().copied() {
        registrar.unregister(key)?;
        current.pop();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use tauri_plugin_global_shortcut::Modifiers;

    use super::*;

    #[derive(Default)]
    struct FakeRegistrar {
        held: Vec<(Shortcut, u32)>,
        taken: HashSet<Shortcut>,
        failing: HashSet<Shortcut>,
    }

    impl Registrar for FakeRegistrar {
        fn is_taken(&self, key: Shortcut) -> bool {
            self.taken.contains(&key)
        }

        fn register(&mut self, key: Shortcut, index: u32) -> Result<(), String> {
            if self.failing.contains(&key) {
                return Err(format!("{key} is taken by another app"));
            }
            self.held.push((key, index));
            Ok(())
        }

        fn unregister(&mut self, key: Shortcut) -> Result<(), String> {
            self.held.retain(|(held, _)| *held != key);
            Ok(())
        }
    }

    fn keys(values: &[&str]) -> Vec<Shortcut> {
        parse_mark_shortcuts(&values.iter().map(|v| v.to_string()).collect::<Vec<_>>()).unwrap()
    }

    #[test]
    fn lesson_mark_shortcuts_parse_as_option_digits() {
        let parsed = keys(&["Alt+1", "Alt+2", "Alt+3"]);
        let digits = [Code::Digit1, Code::Digit2, Code::Digit3];
        for (key, digit) in parsed.iter().zip(digits) {
            assert_eq!(key.mods, Modifiers::ALT);
            assert_eq!(key.key, digit);
        }
    }

    #[test]
    fn rejects_unusable_mark_shortcuts() {
        for list in [
            vec!["Alt+1", "not-a-shortcut"],
            vec!["1"],
            vec!["Alt+Escape"],
            vec!["Alt+1", "Alt+1"],
        ] {
            let list = list.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(parse_mark_shortcuts(&list).is_err(), "{list:?}");
        }
        assert!(parse_mark_shortcuts(&[]).unwrap().is_empty());
    }

    #[test]
    fn registering_replaces_the_previous_set_with_indexes() {
        let mut registrar = FakeRegistrar::default();
        let mut current = Vec::new();
        replace(&mut registrar, &mut current, keys(&["Alt+1", "Alt+2"])).unwrap();
        replace(&mut registrar, &mut current, keys(&["Alt+2", "Alt+3"])).unwrap();

        assert_eq!(current, keys(&["Alt+2", "Alt+3"]));
        assert_eq!(
            registrar.held,
            keys(&["Alt+2", "Alt+3"])
                .into_iter()
                .zip([0, 1])
                .collect::<Vec<_>>()
        );

        clear(&mut registrar, &mut current).unwrap();
        assert!(current.is_empty() && registrar.held.is_empty());
    }

    #[test]
    fn a_shortcut_held_elsewhere_keeps_the_previous_set() {
        let mut registrar = FakeRegistrar::default();
        let mut current = Vec::new();
        replace(&mut registrar, &mut current, keys(&["Alt+1"])).unwrap();
        registrar.taken.insert(keys(&["Control+Alt+KeyD"])[0]);
        // A mark shortcut it already holds is not a conflict with itself.
        registrar.taken.insert(keys(&["Alt+1"])[0]);

        let result = replace(
            &mut registrar,
            &mut current,
            keys(&["Alt+1", "Control+Alt+KeyD"]),
        );

        assert!(result.is_err());
        assert_eq!(current, keys(&["Alt+1"]));
        assert_eq!(registrar.held, vec![(keys(&["Alt+1"])[0], 0)]);
    }

    #[test]
    fn a_failed_registration_leaves_no_half_registered_set() {
        let mut registrar = FakeRegistrar::default();
        registrar.failing.insert(keys(&["Alt+3"])[0]);
        let mut current = Vec::new();

        let result = replace(
            &mut registrar,
            &mut current,
            keys(&["Alt+1", "Alt+2", "Alt+3"]),
        );

        assert!(result.is_err());
        assert!(current.is_empty());
        assert!(registrar.held.is_empty());
    }

    #[test]
    fn only_a_press_reports_a_mark() {
        assert_eq!(
            mark_event(2, ShortcutState::Pressed).map(|event| event.index),
            Some(2)
        );
        assert!(mark_event(2, ShortcutState::Released).is_none());
    }
}
