import AppKit
import SwiftRs

// Short, quiet cues for dictation starting and finishing. They use macOS's own system sounds,
// so nothing is bundled, and a cue that is already playing is cut off by the next one.

private let cues: [Int: (name: String, volume: Float)] = [
  0: ("Pop", 0.35),
  1: ("Bottle", 0.3),
]

private var playing: [NSSound] = []

/// `kind`: 0 when listening starts, 1 when it finishes. Unknown kinds play nothing.
@_cdecl("_dictation_play_sound")
public func dictationPlaySound(kind: Int) {
  guard let cue = cues[kind] else { return }
  DispatchQueue.main.async {
    playing.forEach { $0.stop() }
    playing.removeAll()
    guard let sound = NSSound(named: NSSound.Name(cue.name))?.copy() as? NSSound else { return }
    sound.volume = cue.volume
    // Kept until the next cue, so the sound isn't released while it plays.
    playing.append(sound)
    sound.play()
  }
}
