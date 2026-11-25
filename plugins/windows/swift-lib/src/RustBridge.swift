import Foundation

@_silgen_name("rust_on_floating_bar_stop")
private func rustOnFloatingBarStop()

@_silgen_name("rust_on_floating_bar_pause")
private func rustOnFloatingBarPause(_ paused: Int32)

@_silgen_name("rust_on_floating_bar_open_main")
private func rustOnFloatingBarOpenMain()

@_silgen_name("rust_on_floating_bar_mark")
private func rustOnFloatingBarMark(_ kind: UnsafePointer<CChar>)

@_silgen_name("rust_on_floating_bar_settings_change")
private func rustOnFloatingBarSettingsChange(_ settingsPtr: UnsafePointer<CChar>)

@_silgen_name("rust_on_floating_bar_dictation_action")
func rust_on_floating_bar_dictation_action(_ payload: UnsafePointer<CChar>)

enum RustBridge {
  static func stopListening() {
    rustOnFloatingBarStop()
  }

  static func setPaused(_ paused: Bool) {
    rustOnFloatingBarPause(paused ? 1 : 0)
  }

  static func openMainWindow() {
    rustOnFloatingBarOpenMain()
  }

  static func addMark(_ kind: FloatingBarMarkKind) {
    kind.rawValue.withCString { rustOnFloatingBarMark($0) }
  }

  static func floatingBarSettingsChanged(_ payload: FloatingOverlaySettingsChangePayload) {
    guard
      let data = try? JSONEncoder().encode(payload),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }

    json.withCString { settingsPtr in
      rustOnFloatingBarSettingsChange(settingsPtr)
    }
  }
}
