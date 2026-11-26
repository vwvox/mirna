import Cocoa
import XCTest

@testable import swift_lib

final class FloatingBarMarksTests: XCTestCase {
  private let baseJSON = """
    {"amplitude":0,"title":"Lesson","status":"recording","colorScheme":"dark","opacity":0.8,\
    "liveCaptionOpacity":0.3,"liveCaptionWidth":440,"liveCaptionLineCount":1,\
    "liveCaptionPosition":"topCenter","liveCaptionMinimized":true,"liveCaptionToggleVisible":true
    """

  func testPayloadsWithoutMarksStillDecode() throws {
    let payload = try JSONDecoder().decode(
      FloatingBarStatePayload.self, from: Data((baseJSON + "}").utf8))
    XCTAssertNil(payload.marksEnabled)

    let lesson = try JSONDecoder().decode(
      FloatingBarStatePayload.self, from: Data((baseJSON + ",\"marksEnabled\":true}").utf8))
    XCTAssertEqual(lesson.marksEnabled, true)
  }

  func testMarksWidenOnlyTheCompactBar() {
    XCTAssertEqual(
      FloatingBarLayout.containerSize(
        isExpanded: false, showsExpand: true, showsPause: false, showsMarks: true),
      NSSize(width: 202, height: 67))
    XCTAssertEqual(
      FloatingBarLayout.containerSize(
        isExpanded: false, showsExpand: false, showsPause: false, showsMarks: true
      ).width,
      FloatingBarLayout.containerSize(isExpanded: false, showsExpand: false, showsPause: false)
        .width + 94)
    XCTAssertEqual(
      FloatingBarLayout.containerSize(
        isExpanded: true, showsExpand: true, showsPause: false, showsMarks: true),
      FloatingBarLayout.containerSize(isExpanded: true, showsExpand: true, showsPause: false))
  }

  func testMarksAndPauseFitSideBySide() {
    let both = FloatingBarLayout.compactControlsWidth(
      showsExpand: true, showsPause: true, showsMarks: true)
    XCTAssertEqual(
      both,
      FloatingBarLayout.compactControlsWidth(showsExpand: true, showsPause: true)
        + FloatingBarLayout.compactMarksWidth)
  }

  func testMarkKindsMatchTheRustEvent() {
    XCTAssertEqual(
      FloatingBarMarkKind.allCases.map(\.rawValue), ["important", "confused", "homework"])
    XCTAssertEqual(FloatingBarMarkKind.important.help, "Important (⌥1)")
  }
}
