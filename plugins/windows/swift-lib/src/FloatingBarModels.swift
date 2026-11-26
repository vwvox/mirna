import Foundation

enum FloatingBarStatus: String, Codable, Equatable {
  case recording
  case reconnecting
  case error
}

enum FloatingBarColorScheme: String, Codable, Equatable {
  case light
  case dark
}

struct FloatingTranscriptBubblePayload: Codable, Identifiable, Equatable {
  let id: String
  let speakerLabel: String
  let text: String
  let isSelf: Bool
  let isFinal: Bool
  let startMs: Double
  let endMs: Double
  let overlapsPrevious: Bool
  let overlapsNext: Bool
}

struct FloatingDictationPayload: Codable, Equatable {
  let sessionId: String
  let phase: String
  let microphone: String
  let text: String
  let partial: String
  let previewEnabled: Bool
  let previewUnavailable: Bool
}

enum FloatingBarMarkKind: String, CaseIterable {
  case important
  case confused
  case homework

  var systemImage: String {
    switch self {
    case .important: return "star"
    case .confused: return "questionmark.circle"
    case .homework: return "book"
    }
  }

  var confirmedSystemImage: String { systemImage + ".fill" }

  var help: String {
    switch self {
    case .important: return "Important (⌥1)"
    case .confused: return "I didn't get this (⌥2)"
    case .homework: return "Homework (⌥3)"
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .important: return "Mark as important"
    case .confused: return "Mark as didn't get it"
    case .homework: return "Mark as homework"
    }
  }
}

struct FloatingBarStatePayload: Codable {
  let dictation: FloatingDictationPayload?
  let amplitude: Double
  let title: String
  let status: FloatingBarStatus
  let colorScheme: FloatingBarColorScheme
  let opacity: Double
  let liveCaptionOpacity: Double
  let liveCaptionWidth: Double
  let liveCaptionLineCount: Int
  let liveCaptionPosition: LiveCaptionPosition
  let liveCaptionMinimized: Bool
  let liveCaptionToggleVisible: Bool
  let transcriptBubbles: [FloatingTranscriptBubblePayload]?
  var transcriptNotice: String? = nil
  // Optional so a payload without the key still decodes; Rust always sends it.
  var marksEnabled: Bool? = nil
  var paused: Bool? = nil

  var isPaused: Bool { paused ?? false }
}
