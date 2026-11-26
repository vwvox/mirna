import Combine
import Foundation

final class FloatingBarViewModel: ObservableObject {
  @Published var dictation: FloatingDictationPayload?
  @Published var amplitude: Double = 0
  @Published var paused: Bool = false
  @Published var status: FloatingBarStatus = .recording
  @Published var colorScheme: FloatingBarColorScheme = .dark
  @Published var isExpanded: Bool = false
  @Published var liveCaptionToggleVisible: Bool = false
  @Published var marksEnabled: Bool = false
  @Published var title: String = "Live transcript"
  @Published var transcriptBubbles: [FloatingTranscriptBubblePayload] = []
  @Published var transcriptNotice: String?
  @Published var placement: FloatingControlPlacement.Layout?

  var showsPause: Bool { dictation == nil }
  var showsCancel: Bool { dictation != nil }
  /// The slot beside the main control holds pause for a meeting or cancel for a dictation.
  var showsSecondaryControl: Bool { showsPause || showsCancel }
}
