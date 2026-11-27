import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  CornerCurve,
  FontFamily,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { clipUri } from "@/mac-link/lessons";
import { useReviewOutbox } from "@/mac-link/schedule";
import { formatSize } from "@/note/mac-progress";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import { type ClipPlayer, useClipPlayer } from "./clip-player";
import { inlineMathToText, latexToText } from "./latex-text";
import { describeLastReview, lastReview } from "./lesson-model";
import { piecesFor, type ReviewClip } from "./review-plan";
import type { LessonSheet, PhoneSheetDocument } from "./sheet";
import type { PhoneLesson } from "./use-lesson";

/**
 * A lesson's study sheet on the phone: the same sheet as on the Mac, in one
 * column, with the teacher's clips; the review card on top.
 */
export function LessonSheetView({
  sessionId,
  lesson,
}: {
  sessionId: string;
  lesson: PhoneLesson;
}) {
  const styles = useStyles();
  const player = useClipPlayer(sessionId);
  const document = lesson.sheet;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <ReviewCard sessionId={sessionId} lesson={lesson} />
      {document ? (
        <SheetSections document={document} player={player} />
      ) : (
        <Text style={styles.muted}>
          Your Mac is writing the study sheet. It appears here at the next sync.
        </Text>
      )}
      <StoredLine sessionId={sessionId} lesson={lesson} />
    </ScrollView>
  );
}

function ReviewCard({
  sessionId,
  lesson,
}: {
  sessionId: string;
  lesson: PhoneLesson;
}) {
  const styles = useStyles();
  const router = useRouter();
  const outbox = useReviewOutbox();
  const plan = lesson.review?.plan;
  const last = lastReview(
    lesson.mac?.reviews ?? [],
    outbox.filter((entry) => entry.session_id === sessionId),
  );
  const start = (length: 5 | 10) =>
    router.push(`/review/${sessionId}?length=${length}`);
  const canStart = (length: 5 | 10) =>
    Boolean(plan && lesson.mac && piecesFor(plan, length).length > 0);

  return (
    <View style={styles.reviewCard}>
      <Text accessibilityRole="header" style={styles.reviewTitle}>
        Review
      </Text>
      <Text style={styles.reviewText}>
        {plan
          ? "Your Mac’s review of this lesson: the same pieces in the same order. Works offline."
          : "Your Mac is planning the review. It comes with the next sync."}
      </Text>
      {plan && (
        <View style={styles.reviewButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start the five-minute review"
            disabled={!canStart(5)}
            onPress={() => start(5)}
            style={({ pressed }) => [
              styles.startButton,
              (pressed || !canStart(5)) && styles.pressed,
            ]}
          >
            <Ionicons name="play" size={16} color="#1C2B23" />
            <Text style={styles.startLabel}>Start · 5 min</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start the ten-minute review"
            disabled={!canStart(10)}
            onPress={() => start(10)}
            style={({ pressed }) => [
              styles.longButton,
              (pressed || !canStart(10)) && styles.pressed,
            ]}
          >
            <Text style={styles.longLabel}>10 min</Text>
          </Pressable>
        </View>
      )}
      {last && (
        <Text style={styles.reviewMeta}>
          {describeLastReview(last)}
          {last.state === "waiting"
            ? " · waiting for the Mac"
            : last.state === "sent"
              ? " · sent to the Mac"
              : ""}
        </Text>
      )}
    </View>
  );
}

function SheetSections({
  document,
  player,
}: {
  document: PhoneSheetDocument;
  player: ClipPlayer;
}) {
  const styles = useStyles();
  const { sheet, clips } = document;
  const clip = (key: string) => clips[key] ?? null;
  return (
    <>
      {(sheet.summary || sheet.topic) && (
        <Text style={styles.summary}>{sheet.summary || sheet.topic}</Text>
      )}
      {sheet.kind === "language" ? (
        <LanguageSections sheet={sheet} clip={clip} player={player} />
      ) : (
        <SubjectSections sheet={sheet} clip={clip} player={player} />
      )}
      {sheet.corrections.length > 0 && (
        <Section
          title={sheet.kind === "language" ? "Your slips" : "Slips"}
          detail="What was said, and how to say it"
        >
          {sheet.corrections.map((slip, index) => (
            <View key={index} style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemCopy}>
                  <Text style={[styles.itemText, styles.struck]}>
                    {slip.said}
                  </Text>
                  <Text style={styles.itemTitle}>{slip.corrected}</Text>
                  {slip.why ? (
                    <Text style={styles.itemDetail}>{slip.why}</Text>
                  ) : null}
                </View>
                <ClipButton
                  clip={clip(`slip:${slip.said}`)}
                  player={player}
                  label={`Play the teacher on ${slip.corrected}`}
                />
              </View>
            </View>
          ))}
        </Section>
      )}
      {sheet.homework.length > 0 && (
        <Section title="Homework">
          {sheet.homework.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemText}>{item.text}</Text>
              {item.due ? (
                <Text style={styles.itemDetail}>Due {item.due}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}
      {sheet.openQuestions.length > 0 && (
        <Section title="Open questions">
          {sheet.openQuestions.map((question, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemText}>{question}</Text>
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

type SectionProps = {
  sheet: LessonSheet;
  clip: (key: string) => ReviewClip | null;
  player: ClipPlayer;
};

function LanguageSections({ sheet, clip, player }: SectionProps) {
  const styles = useStyles();
  const fresh = sheet.vocabulary.filter((word) => word.isNew).length;
  const earlier = sheet.vocabulary.length - fresh;
  return (
    <>
      {sheet.vocabulary.length > 0 && (
        <Section
          title="Words"
          detail={[
            fresh ? `${fresh} new` : null,
            earlier ? `${earlier} from earlier lessons` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {sheet.vocabulary.map((word, index) => (
            <View key={`${word.term}-${index}`} style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemCopy}>
                  <Text style={styles.term}>{word.term}</Text>
                  {word.reading ? (
                    <Text style={styles.reading}>{word.reading}</Text>
                  ) : null}
                  <Text style={styles.itemText}>{word.meaning}</Text>
                  {word.note ? (
                    <Text style={styles.itemDetail}>{word.note}</Text>
                  ) : null}
                </View>
                <ClipButton
                  clip={clip(`word:${word.term}`)}
                  player={player}
                  label={`Play the teacher saying ${word.term}`}
                />
              </View>
            </View>
          ))}
        </Section>
      )}
      {sheet.patterns.length > 0 && (
        <Section title="Patterns">
          {sheet.patterns.map((pattern, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemTitle}>{pattern.pattern}</Text>
              {pattern.explanation ? (
                <Text style={styles.itemText}>{pattern.explanation}</Text>
              ) : null}
              {pattern.examples.map((example, exampleIndex) => (
                <View key={exampleIndex} style={styles.itemRow}>
                  <View style={styles.itemCopy}>
                    <Text style={styles.example}>{example.text}</Text>
                    {example.translation ? (
                      <Text style={styles.itemDetail}>
                        {example.translation}
                      </Text>
                    ) : null}
                  </View>
                  <ClipButton
                    clip={clip(`example:${example.text}`)}
                    player={player}
                    label={`Play the example from class`}
                  />
                </View>
              ))}
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

function SubjectSections({ sheet, clip, player }: SectionProps) {
  const styles = useStyles();
  return (
    <>
      {sheet.keyTerms.length > 0 && (
        <Section title="Key terms">
          {sheet.keyTerms.map((term, index) => (
            <View key={`${term.term}-${index}`} style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemTitle}>{term.term}</Text>
                  <Text style={styles.itemText}>{term.definition}</Text>
                </View>
                <ClipButton
                  clip={clip(`term:${term.term}`)}
                  player={player}
                  label={`Play the teacher on ${term.term}`}
                />
              </View>
            </View>
          ))}
        </Section>
      )}
      {sheet.ideas.length > 0 && (
        <Section title="Ideas">
          {sheet.ideas.map((idea, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemTitle}>{idea.title}</Text>
              <Text style={styles.itemText}>{idea.explanation}</Text>
              {idea.example ? (
                <Text style={styles.itemDetail}>In class: {idea.example}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}
      {sheet.formulas.length > 0 && (
        <Section title="Formulas">
          {sheet.formulas.map((formula, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemTitle}>{formula.name}</Text>
              <Text style={styles.formula}>{latexToText(formula.latex)}</Text>
              {formula.symbols.map((symbol, symbolIndex) => (
                <Text key={symbolIndex} style={styles.itemDetail}>
                  {latexToText(symbol.symbol)}: {symbol.meaning}
                </Text>
              ))}
              {formula.whenToUse ? (
                <Text style={styles.itemText}>{formula.whenToUse}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}
      {sheet.methods.length > 0 && (
        <Section title="Methods">
          {sheet.methods.map((method, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemTitle}>{method.title}</Text>
              <Steps steps={method.steps.map((step) => step.text)} />
            </View>
          ))}
        </Section>
      )}
      {sheet.workedExamples.length > 0 && (
        <Section title="Worked examples">
          {sheet.workedExamples.map((example, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemText}>
                {inlineMathToText(example.problem)}
              </Text>
              <Steps steps={example.steps.map((step) => step.text)} />
              {example.answer ? (
                <Text style={styles.itemTitle}>
                  {inlineMathToText(example.answer)}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}
      {sheet.sources.length > 0 && (
        <Section title="Sources">
          {sheet.sources.map((source, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemTitle}>
                {source.name}
                {source.year ? ` · ${source.year}` : ""}
              </Text>
              {source.note ? (
                <Text style={styles.itemText}>{source.note}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}
      {sheet.checkYourself.length > 0 && (
        <Section title="Check yourself" detail="Answer, then tap to see">
          {sheet.checkYourself.map((item, index) => (
            <Reveal
              key={index}
              prompt={item.question}
              answer={<Text style={styles.itemText}>{item.answer}</Text>}
            />
          ))}
        </Section>
      )}
      {sheet.problems.length > 0 && (
        <Section title="Problems" detail="Work it out, then tap to see">
          {sheet.problems.map((problem, index) => (
            <Reveal
              key={index}
              prompt={inlineMathToText(problem.question)}
              answer={
                <>
                  <Steps steps={problem.steps} />
                  <Text style={styles.itemTitle}>
                    {inlineMathToText(problem.answer)}
                  </Text>
                </>
              }
            />
          ))}
        </Section>
      )}
    </>
  );
}

function Section({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.sectionBody}>
        {/* The last item's line hides under the card's edge. */}
        <View style={styles.sectionItems}>{children}</View>
      </View>
    </View>
  );
}

function Steps({ steps }: { steps: string[] }) {
  const styles = useStyles();
  if (steps.length === 0) return null;
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => (
        <View key={index} style={styles.step}>
          <Text style={styles.stepNumber}>{index + 1}</Text>
          <Text style={[styles.itemText, styles.itemCopy]}>
            {inlineMathToText(step)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Reveal({ prompt, answer }: { prompt: string; answer: ReactNode }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? undefined : "Shows the answer"}
      onPress={() => setOpen((value) => !value)}
      style={styles.item}
    >
      <Text style={styles.itemTitle}>{prompt}</Text>
      {open ? (
        answer
      ) : (
        <Text style={styles.itemDetail}>Tap to see the answer</Text>
      )}
    </Pressable>
  );
}

function ClipButton({
  clip,
  player,
  label,
}: {
  clip: ReviewClip | null;
  player: ClipPlayer;
  label: string;
}) {
  const styles = useStyles();
  const Colors = useColors();
  if (!player.has(clip)) return null;
  const playing = player.playing === clip.id;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => player.play(clip)}
      style={({ pressed }) => [styles.clip, pressed && styles.pressed]}
    >
      <Ionicons
        name={playing ? "volume-high" : "play"}
        size={16}
        color={Colors.primary}
      />
    </Pressable>
  );
}

/** What of the lesson is on this phone, so it can be reviewed offline. */
function StoredLine({
  sessionId,
  lesson,
}: {
  sessionId: string;
  lesson: PhoneLesson;
}) {
  const styles = useStyles();
  const clips = (lesson.mac?.clips ?? []).filter((clip) =>
    clipUri(sessionId, clip.id),
  );
  if (!lesson.sheet && !lesson.review) return null;
  const parts = [
    lesson.sheet ? "the sheet" : null,
    lesson.review ? "the review" : null,
    clips.length > 0
      ? `${clips.length} clip${clips.length === 1 ? "" : "s"} · ${formatSize(
          clips.reduce((sum, clip) => sum + clip.size, 0),
        )}`
      : null,
  ].filter(Boolean);
  const missing = (lesson.mac?.clips.length ?? 0) - clips.length;
  return (
    <Text style={styles.stored}>
      On this phone: {parts.join(", ")}
      {missing > 0 ? `. ${missing} more clips come with the next sync.` : "."}
    </Text>
  );
}

const useStyles = createStyleHook((Colors) => ({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.roomy,
    gap: Spacing.lg,
  },
  muted: { ...Typography.body, color: Colors.muted },
  reviewCard: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: "#21342A",
  },
  reviewTitle: { ...Typography.section, color: "#F1EFE7" },
  reviewText: { ...Typography.caption, color: "#B5C2B9" },
  reviewButtons: { flexDirection: "row", gap: Spacing.sm, marginTop: 4 },
  startButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: "#E3B23C",
  },
  startLabel: { ...Typography.bodyStrong, color: "#1C2B23" },
  longButton: {
    minWidth: 96,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: "#4B6A58",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
  },
  longLabel: { ...Typography.bodyStrong, color: "#F1EFE7" },
  reviewMeta: { ...Typography.caption, color: "#B5C2B9" },
  pressed: { opacity: 0.6 },
  summary: { ...Typography.body, color: Colors.ink },
  section: { gap: Spacing.sm },
  sectionHead: { gap: 2 },
  sectionTitle: { ...Typography.section, color: Colors.ink },
  sectionDetail: { ...Typography.caption, color: Colors.muted },
  sectionItems: { marginBottom: -1 },
  sectionBody: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  item: {
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.compact,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  itemCopy: { flex: 1, gap: 2 },
  itemTitle: { ...Typography.bodyStrong, color: Colors.ink },
  itemText: { ...Typography.body, color: Colors.ink },
  itemDetail: { ...Typography.caption, color: Colors.muted },
  struck: {
    color: Colors.accent,
    textDecorationLine: "line-through",
  },
  term: { fontSize: 26, lineHeight: 34, color: Colors.ink },
  reading: { ...Typography.caption, color: Colors.primary },
  example: { fontSize: 18, lineHeight: 26, color: Colors.ink },
  formula: {
    fontFamily: FontFamily.mono,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.ink,
  },
  steps: { gap: 6, marginTop: 4 },
  step: { flexDirection: "row", gap: Spacing.sm },
  stepNumber: {
    ...Typography.captionStrong,
    width: 20,
    color: Colors.muted,
    textAlign: "right",
  },
  clip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: Colors.accentSurface,
  },
  stored: { ...Typography.caption, color: Colors.muted },
}));
