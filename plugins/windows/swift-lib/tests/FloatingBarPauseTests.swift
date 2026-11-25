import Cocoa
import XCTest

@testable import swift_lib

final class FloatingBarPauseTests: XCTestCase {
  func testPauseButtonWidensTheCompactControlsByOneIcon() {
    for showsExpand in [false, true] {
      XCTAssertEqual(
        FloatingBarLayout.compactControlsWidth(showsExpand: showsExpand, showsPause: true),
        FloatingBarLayout.compactControlsWidth(showsExpand: showsExpand, showsPause: false)
          + FloatingBarLayout.compactIconSize)
    }
    XCTAssertEqual(
      FloatingBarLayout.containerSize(isExpanded: false, showsExpand: true, showsPause: true),
      NSSize(width: 138, height: 67))
    XCTAssertEqual(
      FloatingBarLayout.containerSize(isExpanded: false, showsExpand: false, showsPause: true),
      NSSize(width: 114, height: 67))
    XCTAssertEqual(
      FloatingBarLayout.containerSize(isExpanded: true, showsExpand: true, showsPause: true),
      NSSize(width: 368, height: 459))
  }

  func testPauseButtonIsOnlyForMeetingRecordings() {
    let model = FloatingBarViewModel()
    XCTAssertTrue(model.showsPause)
    model.dictation = FloatingDictationPayload(
      sessionId: "dictation", phase: "recording", microphone: "Mic", text: "", partial: "",
      previewEnabled: true, previewUnavailable: false)
    XCTAssertFalse(model.showsPause)
  }

  func testPausedDecodesAsFalseWhenMissing() throws {
    XCTAssertFalse(try decode(paused: nil).isPaused)
    XCTAssertFalse(try decode(paused: false).isPaused)
    XCTAssertTrue(try decode(paused: true).isPaused)
  }

  private func decode(paused: Bool?) throws -> FloatingBarStatePayload {
    var json: [String: Any] = [
      "amplitude": 0, "title": "Meeting", "status": "recording", "colorScheme": "dark",
      "opacity": 1, "liveCaptionOpacity": 1, "liveCaptionWidth": 360,
      "liveCaptionLineCount": 2, "liveCaptionPosition": "topCenter",
      "liveCaptionMinimized": true, "liveCaptionToggleVisible": true,
    ]
    if let paused { json["paused"] = paused }
    let data = try JSONSerialization.data(withJSONObject: json)
    return try JSONDecoder().decode(FloatingBarStatePayload.self, from: data)
  }
}
