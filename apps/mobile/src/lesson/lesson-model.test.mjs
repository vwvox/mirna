import assert from "node:assert/strict";
import test from "node:test";

import {
  afterUpload,
  clipChanges,
  describeLastReview,
  isValidTag,
  lastReview,
  nextLessonNumber,
  queueReview,
  reviewBatches,
  settingsFromTag,
  tagForCourse,
  whenLabel,
} from "./lesson-model.ts";
import {
  answerMatches,
  cardsOutcome,
  intoPractice,
  parseReviewPlanDocument,
  piecesFor,
  planClips,
} from "./review-plan.ts";
import { parseSheetDocument } from "./sheet.ts";

const tag = {
  course: "Mandarin · Lǎoshī Chen",
  subject: "language",
  learning: "zh",
  explain_in: "en",
};

test("a lesson tag follows the Mac's rules", () => {
  assert.equal(isValidTag(tag), true);
  assert.equal(isValidTag({ ...tag, course: "  " }), false);
  assert.equal(isValidTag({ ...tag, course: "Maths/Year 2" }), false);
  assert.equal(isValidTag({ ...tag, subject: "history" }), false);
  assert.equal(isValidTag({ ...tag, learning: "" }), false);
});

test("a tag becomes the Mac's lesson settings", () => {
  assert.deepEqual(settingsFromTag(tag), {
    learning: "zh",
    explainIn: "en",
    subject: "language",
  });
  assert.deepEqual(
    settingsFromTag({
      ...tag,
      subject: "topic",
      subject_name: " Contract law ",
    }).subjectName,
    "Contract law",
  );
});

test("a recording filed in a course takes the course's settings and number", () => {
  const courses = [
    {
      name: "Mandarin",
      subject: "language",
      learning: "zh",
      explain_in: "en",
      next_number: 15,
    },
  ];
  assert.equal(nextLessonNumber(courses, " mandarin "), 15);
  assert.equal(nextLessonNumber(courses, "Statistics"), 1);
  assert.deepEqual(tagForCourse(courses[0]), {
    course: "Mandarin",
    subject: "language",
    learning: "zh",
    explain_in: "en",
    subject_name: null,
  });
});

const run = (id, endedAt, outcomes = ["knew"]) => ({
  id,
  startedAt: endedAt,
  endedAt,
  length: 5,
  device: "phone",
  planHash: "h",
  results: outcomes.map((outcome, index) => ({
    pieceId: `p${index}`,
    kind: "quick_fire",
    outcome,
    cardId: null,
    markId: null,
  })),
});

test("reviews go to the Mac by lesson, at most twenty at a time", () => {
  let outbox = [];
  for (let index = 0; index < 23; index += 1) {
    outbox = queueReview(outbox, {
      session_id: "a",
      mac_session_id: "mac-a",
      run: run(`a${index}`, "2026-11-27T08:00:00Z"),
      sent_at: null,
    });
  }
  outbox = queueReview(outbox, {
    session_id: "b",
    mac_session_id: "mac-b",
    run: run("b0", "2026-11-27T09:00:00Z"),
    sent_at: null,
  });
  const batches = reviewBatches(outbox);
  assert.deepEqual(
    batches.map((batch) => [batch.mac_session_id, batch.entries.length]),
    [
      ["mac-a", 20],
      ["mac-a", 3],
      ["mac-b", 1],
    ],
  );

  const now = new Date("2026-11-27T10:00:00Z");
  const next = afterUpload(outbox, {
    accepted: ["a0", "b0"],
    dropped: ["a1"],
    counted: ["a2"],
    now,
  });
  // 24 queued, one dropped, one already counted by the Mac.
  assert.equal(next.length, 22);
  assert.equal(
    next.find((entry) => entry.run.id === "a0").sent_at,
    now.toISOString(),
  );
  assert.equal(
    reviewBatches(next).flatMap((batch) => batch.entries).length,
    20,
  );

  // Sent ones the Mac never counted go after two weeks.
  const later = afterUpload(next, {
    accepted: [],
    dropped: [],
    counted: [],
    now: new Date("2026-12-12T10:00:00Z"),
  });
  assert.equal(later.length, 20);
  assert.ok(later.every((entry) => !entry.sent_at));
});

test("the lesson shows its latest review, from the Mac or still on the phone", () => {
  const mac = [
    {
      id: "m1",
      ended_at: "2026-11-25T21:10:00Z",
      device: "mac",
      length: 5,
      right: 5,
      total: 6,
    },
  ];
  assert.equal(lastReview(mac, []).state, "counted");
  const queued = [
    {
      session_id: "a",
      mac_session_id: "mac-a",
      run: run("p1", "2026-11-27T08:12:00Z", ["knew", "shaky", "knew"]),
      sent_at: null,
    },
  ];
  const latest = lastReview(mac, queued);
  assert.deepEqual(
    { ...latest },
    {
      endedAt: "2026-11-27T08:12:00Z",
      device: "phone",
      right: 2,
      total: 3,
      state: "waiting",
    },
  );
  // Counted by the Mac now: shown once, as the Mac's.
  assert.equal(
    lastReview(
      [
        ...mac,
        {
          ...mac[0],
          id: "p1",
          ended_at: queued[0].run.endedAt,
          device: "phone",
        },
      ],
      queued,
    ).state,
    "counted",
  );
  assert.equal(lastReview([], []), null);
});

test("review times read like the mock-ups", () => {
  const now = new Date(2026, 10, 27, 9, 30);
  assert.equal(
    whenLabel(new Date(2026, 10, 27, 8, 12).toISOString(), now),
    "today 08:12",
  );
  assert.equal(
    whenLabel(new Date(2026, 10, 26, 21, 10).toISOString(), now),
    "yesterday 21:10",
  );
  assert.equal(
    whenLabel(new Date(2026, 10, 25, 21, 10).toISOString(), now),
    "Wednesday 21:10",
  );
  assert.equal(
    whenLabel(new Date(2026, 10, 10, 21, 10).toISOString(), now),
    "10 Nov",
  );
  assert.equal(
    describeLastReview(
      {
        endedAt: new Date(2026, 10, 27, 8, 12).toISOString(),
        device: "phone",
        right: 5,
        total: 6,
        state: "waiting",
      },
      now,
    ),
    "Last: today 08:12 on the phone · 5 of 6 right",
  );
});

test("only the newest lessons keep their clips", () => {
  const lessons = Array.from({ length: 12 }, (_, index) => ({
    session_id: `s${index}`,
    created_at: `2026-11-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    clips: [{ id: `c${index}`, size: 1, sha256: "x" }],
  }));
  const present = new Map([
    ["s11", ["c11.mp3", "stale.mp3", "c11.part"]],
    ["s0", ["c0.mp3"]],
    ["s1", []],
  ]);
  const changes = clipChanges(lessons, present, 10);
  assert.deepEqual(changes.clearLessons, ["s0"]);
  assert.deepEqual(changes.removeFiles.map((file) => file.name).sort(), [
    "c11.part",
    "stale.mp3",
  ]);
  assert.equal(changes.download.length, 9);
  assert.ok(!changes.download.some((entry) => entry.session_id === "s11"));
  assert.ok(!changes.download.some((entry) => entry.session_id === "s1"));
});

const piece = (id, body, extra = {}) => ({
  id,
  kind: "quick_fire",
  core: true,
  seconds: 30,
  written: false,
  source: "",
  prompt: "Say it",
  body,
  explain: "",
  clips: [],
  cardId: null,
  markId: null,
  ...extra,
});

test("the phone plays the Mac's plan as it is, skipping pieces it can't play", () => {
  const clip = { id: "c1-2-1", startMs: 1, endMs: 2, channel: 1, label: "" };
  const document = parseReviewPlanDocument(
    JSON.stringify({
      plan: {
        version: 1,
        mindset: "language",
        learning: "zh",
        explainIn: "en",
        withAi: true,
        pieces: [
          piece("a", {
            type: "cards",
            items: [
              {
                front: { text: "饺子" },
                back: { text: "dumplings" },
                clip,
                cardId: "饺子",
              },
            ],
          }),
          piece("b", { type: "speak", prompt: "Say it" }),
          piece(
            "c",
            {
              type: "choice",
              context: null,
              listen: clip,
              options: [{ text: "都不" }, { text: "不都" }],
              answer: 0,
              reveal: [],
            },
            { core: false },
          ),
        ],
      },
      generatedAt: "2026-11-25T10:00:00Z",
      model: "deepseek",
      sourceHash: "h",
    }),
  );
  assert.deepEqual(
    document.plan.pieces.map((entry) => entry.id),
    ["a", "c"],
  );
  assert.deepEqual(
    piecesFor(document.plan, 5).map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(
    planClips(document.plan).map((entry) => entry.id),
    ["c1-2-1"],
  );
  assert.equal(parseReviewPlanDocument("{"), null);
  assert.equal(
    parseReviewPlanDocument(JSON.stringify({ plan: { version: 2 } })),
    null,
  );
});

test("answers are checked as on the Mac", () => {
  assert.equal(answerMatches("12,5", 12.5), true);
  assert.equal(answerMatches("−3", -3), true);
  assert.equal(answerMatches("12.6", 12.5), false);
  assert.equal(answerMatches("", 0), false);
  assert.equal(
    cardsOutcome([{ knew: true }, { knew: true }, { knew: false }]),
    "shaky",
  );
  assert.equal(cardsOutcome([{ knew: true }]), "knew");
  assert.equal(
    cardsOutcome([{ knew: false }, { knew: false }, { knew: true }]),
    "missed",
  );
});

test("the wrap-up lists what comes back in Practise", () => {
  const pieces = [
    piece("a", {
      type: "cards",
      items: [
        {
          front: { text: "面条" },
          back: { text: "noodles" },
          clip: null,
          cardId: "面条",
        },
        {
          front: { text: "饺子" },
          back: { text: "dumplings" },
          clip: null,
          cardId: "饺子",
        },
      ],
    }),
    piece(
      "b",
      { type: "reveal", front: { text: "都 + verb" }, back: [] },
      { cardId: "q:1" },
    ),
  ];
  assert.deepEqual(
    intoPractice(pieces, [
      {
        pieceId: "a",
        kind: "quick_fire",
        outcome: "shaky",
        cardId: null,
        markId: null,
        cards: [
          { cardId: "面条", knew: false },
          { cardId: "饺子", knew: true },
        ],
      },
      {
        pieceId: "b",
        kind: "explain_it",
        outcome: "missed",
        cardId: "q:1",
        markId: null,
      },
    ]),
    ["面条", "都 + verb"],
  );
});

test("a sheet from an older Mac still has every list", () => {
  const document = parseSheetDocument(
    JSON.stringify({
      sheet: {
        version: 1,
        kind: "language",
        summary: "Dumplings",
        vocabulary: [{ term: "饺子" }],
      },
      generatedAt: "x",
      model: "m",
    }),
  );
  assert.equal(document.sheet.vocabulary.length, 1);
  assert.deepEqual(document.sheet.formulas, []);
  assert.deepEqual(document.clips, {});
  assert.equal(parseSheetDocument("not json"), null);
});

test("checked pieces are marked as on the Mac", async () => {
  const { checkedOutcome, FRESH_STATE } = await import("./review-plan.ts");
  const sort = {
    type: "sort",
    groups: [
      { title: "都不", hint: "" },
      { title: "不都", hint: "" },
    ],
    cards: [
      { text: "None of us", group: 0, why: "" },
      { text: "Not all of us", group: 1, why: "" },
      { text: "Nobody drinks", group: 0, why: "" },
    ],
  };
  assert.equal(
    checkedOutcome(sort, { ...FRESH_STATE, placed: { 0: 0 } }),
    null,
  );
  assert.equal(
    checkedOutcome(sort, { ...FRESH_STATE, placed: { 0: 0, 1: 1, 2: 0 } }),
    "knew",
  );
  assert.equal(
    checkedOutcome(sort, { ...FRESH_STATE, placed: { 0: 0, 1: 1, 2: 1 } }),
    "shaky",
  );
  const order = {
    type: "order",
    context: null,
    items: [{ text: "a" }, { text: "b" }],
    shuffled: [1, 0],
  };
  assert.equal(
    checkedOutcome(order, { ...FRESH_STATE, chain: [1, 0] }),
    "missed",
  );
  const number = {
    type: "number",
    context: null,
    steps: [],
    answer: 2.5,
    answerText: "2.5",
  };
  assert.equal(checkedOutcome(number, { ...FRESH_STATE, typed: "2,5" }), null);
  assert.equal(
    checkedOutcome(number, { ...FRESH_STATE, typed: "2,5", revealed: true }),
    "knew",
  );
  assert.equal(
    checkedOutcome(number, {
      ...FRESH_STATE,
      typed: "2,5",
      revealed: true,
      steps: 1,
    }),
    "shaky",
  );
  assert.equal(
    checkedOutcome({ type: "reveal", front: null, back: [] }, FRESH_STATE),
    null,
  );
});
