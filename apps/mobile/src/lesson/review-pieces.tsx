import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  CornerCurve,
  FontFamily,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";

import type { ClipPlayer } from "./clip-player";
import { latexToText } from "./latex-text";
import {
  answerMatches,
  cardsOutcome,
  type PieceState,
  type ReviewClip,
  type ReviewFace,
  type ReviewOutcome,
  type ReviewPiece,
} from "./review-plan";

/** The review's own colours: the same dark focus room as on the Mac. */
export const Focus = {
  background: "#18261F",
  bar: "#1C2D24",
  card: "#21342A",
  answer: "#284034",
  border: "#344E40",
  line: "#4B6A58",
  text: "#F1EFE7",
  muted: "#B5C2B9",
  accent: "#E3B23C",
  onAccent: "#1C2B23",
  good: "#9BD8AE",
  goodSurface: "#1F4130",
  bad: "#F2A585",
  badSurface: "#4A2D22",
} as const;

export function FaceView({
  face,
  size = "body",
}: {
  face: ReviewFace;
  size?: "hero" | "big" | "body";
}) {
  const text = face.latex ? latexToText(face.latex) : face.text;
  return (
    <View style={styles.face}>
      <Text
        style={[
          size === "hero"
            ? styles.hero
            : size === "big"
              ? styles.big
              : styles.body,
          face.latex && styles.formula,
          face.struck && styles.struck,
        ]}
      >
        {text}
      </Text>
      {face.reading ? <Text style={styles.reading}>{face.reading}</Text> : null}
      {face.sub ? <Text style={styles.sub}>{face.sub}</Text> : null}
    </View>
  );
}

export function ClipButton({
  clip,
  player,
  label,
}: {
  clip: ReviewClip;
  player: ClipPlayer;
  label?: string;
}) {
  if (!player.has(clip)) return null;
  const playing = player.playing === clip.id;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? (clip.label || "Play the teacher")}
      onPress={() => player.play(clip)}
      style={({ pressed }) => [styles.clip, pressed && styles.pressed]}
    >
      <Ionicons
        name={playing ? "volume-high" : "play"}
        size={16}
        color={Focus.accent}
      />
      <Text style={styles.clipLabel} numberOfLines={1}>
        {clip.label || "The teacher"}
      </Text>
    </Pressable>
  );
}

function Clips({ clips, player }: { clips: ReviewClip[]; player: ClipPlayer }) {
  const playable = clips.filter((clip) => player.has(clip));
  if (playable.length === 0) return null;
  return (
    <View style={styles.clips}>
      {playable.map((clip) => (
        <ClipButton key={clip.id} clip={clip} player={player} />
      ))}
    </View>
  );
}

function Primary({
  label,
  onPress,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={Focus.onAccent} /> : null}
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

function Quiet({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quiet, style, pressed && styles.pressed]}
    >
      <Text style={styles.quietLabel}>{label}</Text>
    </Pressable>
  );
}

function Answer({ children }: { children: ReactNode }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.answer}>
      {children}
    </View>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <View style={[styles.verdict, ok ? styles.good : styles.bad]}>
      <Ionicons
        name={ok ? "checkmark-circle" : "close-circle"}
        size={18}
        color={ok ? Focus.good : Focus.bad}
      />
      <Text style={styles.verdictText}>{children}</Text>
    </View>
  );
}

function Explain({
  piece,
  player,
}: {
  piece: ReviewPiece;
  player: ClipPlayer;
}) {
  return (
    <>
      {piece.explain ? (
        <Text style={styles.explain}>{piece.explain}</Text>
      ) : null}
      <Clips clips={piece.clips} player={player} />
    </>
  );
}

/**
 * One piece of the Mac's plan, in one column: the question, then the answer
 * under it once given. Pieces the student judges grade themselves; the rest
 * Mirna checks, and the bar's Next moves on.
 */
export function PieceView({
  piece,
  state,
  update,
  onGrade,
  player,
}: {
  piece: ReviewPiece;
  state: PieceState;
  update: (next: Partial<PieceState>) => void;
  onGrade: (
    outcome: ReviewOutcome,
    cards?: { cardId: string; knew: boolean }[],
  ) => void;
  player: ClipPlayer;
}) {
  const { body } = piece;

  if (body.type === "reveal") {
    return (
      <>
        {body.front ? <FaceView face={body.front} size="hero" /> : null}
        {!state.revealed ? (
          <>
            <Text style={styles.hint}>
              Answer out loud or in your head, then check.
            </Text>
            <Primary
              label="Show the answer"
              onPress={() => update({ revealed: true })}
            />
          </>
        ) : (
          <Answer>
            {body.back.map((face, index) => (
              <FaceView
                key={index}
                face={face}
                size={index === 0 ? "big" : "body"}
              />
            ))}
            <Explain piece={piece} player={player} />
            <View style={styles.gradeRow}>
              <Quiet
                label="Missed it"
                onPress={() => onGrade("missed")}
                style={styles.grade}
              />
              <Quiet
                label="Shaky"
                onPress={() => onGrade("shaky")}
                style={styles.grade}
              />
              <Quiet
                label="Knew it"
                onPress={() => onGrade("knew")}
                style={styles.grade}
              />
            </View>
          </Answer>
        )}
      </>
    );
  }

  if (body.type === "cards") {
    const item = body.items[Math.min(state.cardIndex, body.items.length - 1)]!;
    const answer = (knew: boolean) => {
      const cardResults = [
        ...state.cardResults,
        { cardId: item.cardId ?? item.front.text, knew },
      ];
      if (state.cardIndex + 1 >= body.items.length) {
        update({ cardResults });
        onGrade(cardsOutcome(cardResults), cardResults);
      } else {
        update({
          cardResults,
          cardIndex: state.cardIndex + 1,
          revealed: false,
        });
      }
    };
    return (
      <>
        <View style={styles.chips} accessibilityLabel="Cards in this round">
          {body.items.map((entry, index) => {
            const done = state.cardResults[index];
            return (
              <View
                key={index}
                style={[
                  styles.chip,
                  done
                    ? done.knew
                      ? styles.chipGood
                      : styles.chipBad
                    : index === state.cardIndex && styles.chipNow,
                ]}
              >
                <Text style={styles.chipText}>{entry.front.text}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.flashcard}>
          <FaceView face={item.front} size="hero" />
        </View>
        {!state.revealed ? (
          <>
            <Text style={styles.hint}>
              Say it out loud or in your head, then turn it over.
            </Text>
            <Primary
              label="Turn it over"
              onPress={() => update({ revealed: true })}
            />
          </>
        ) : (
          <Answer>
            <FaceView face={item.back} size="big" />
            {item.clip ? <Clips clips={[item.clip]} player={player} /> : null}
            <View style={styles.gradeRow}>
              <Quiet
                label="Missed it"
                onPress={() => answer(false)}
                style={styles.grade}
              />
              <Quiet
                label="Knew it"
                onPress={() => answer(true)}
                style={styles.grade}
              />
            </View>
          </Answer>
        )}
      </>
    );
  }

  if (body.type === "choice") {
    const picked = state.pick !== null;
    const listen = body.listen;
    return (
      <>
        {body.context ? (
          <View style={styles.context}>
            <FaceView face={body.context} size="big" />
          </View>
        ) : null}
        {listen && player.has(listen) ? (
          <Primary
            label="Play it again"
            icon="play"
            onPress={() => player.play(listen)}
          />
        ) : null}
        <View accessibilityRole="radiogroup" style={styles.options}>
          {body.options.map((option, index) => (
            <Pressable
              key={index}
              accessibilityRole="radio"
              accessibilityState={{
                checked: state.pick === index,
                disabled: picked,
              }}
              disabled={picked}
              onPress={() => update({ pick: index, revealed: true })}
              style={[
                styles.option,
                picked && index === body.answer && styles.good,
                picked &&
                  index === state.pick &&
                  index !== body.answer &&
                  styles.bad,
                picked &&
                  index !== body.answer &&
                  index !== state.pick &&
                  styles.faded,
              ]}
            >
              <Text style={styles.optionNumber}>{index + 1}</Text>
              <View style={styles.optionFace}>
                <FaceView face={option} />
              </View>
            </Pressable>
          ))}
        </View>
        {picked && (
          <Answer>
            <Verdict ok={state.pick === body.answer}>
              {state.pick === body.answer ? "Right" : "Not quite"}
            </Verdict>
            {body.reveal.map((face, index) => (
              <FaceView key={index} face={face} size="big" />
            ))}
            <Explain piece={piece} player={player} />
          </Answer>
        )}
      </>
    );
  }

  if (body.type === "sort") {
    const done = Object.keys(state.placed).length === body.cards.length;
    const place = (card: number, group: number) =>
      update({ placed: { ...state.placed, [card]: group } });
    const unplace = (card: number) => {
      const placed = { ...state.placed };
      delete placed[card];
      update({ placed });
    };
    const wrong = body.cards
      .map((card, index) => ({ card, index }))
      .filter(
        ({ card, index }) =>
          state.placed[index] !== undefined &&
          state.placed[index] !== card.group,
      );
    return (
      <>
        {body.cards.map((card, index) =>
          state.placed[index] === undefined ? (
            <View key={index} style={styles.sortCard}>
              <Text style={styles.sortText}>{card.text}</Text>
              <View style={styles.sortButtons}>
                {body.groups.map((group, groupIndex) => (
                  <Pressable
                    key={groupIndex}
                    accessibilityRole="button"
                    accessibilityLabel={`${card.text}: ${group.title}`}
                    onPress={() => place(index, groupIndex)}
                    style={({ pressed }) => [
                      styles.sortButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.sortButtonText}>{group.title}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null,
        )}
        {body.groups.map((group, groupIndex) => (
          <View
            key={groupIndex}
            style={styles.group}
            accessibilityLabel={group.title}
          >
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.hint ? <Text style={styles.sub}>{group.hint}</Text> : null}
            {body.cards.map((card, index) =>
              state.placed[index] === groupIndex ? (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={
                    done ? card.text : `Take ${card.text} out`
                  }
                  disabled={done}
                  onPress={() => unplace(index)}
                  style={[
                    styles.placed,
                    done &&
                      (card.group === groupIndex ? styles.good : styles.bad),
                  ]}
                >
                  <Text style={styles.placedText}>{card.text}</Text>
                  {!done ? (
                    <Ionicons name="close" size={14} color={Focus.muted} />
                  ) : null}
                </Pressable>
              ) : null,
            )}
          </View>
        ))}
        {done && (
          <Answer>
            <Verdict ok={wrong.length === 0}>
              {wrong.length === 0
                ? "All in the right place"
                : `${body.cards.length - wrong.length} of ${body.cards.length} in the right place`}
            </Verdict>
            {wrong.map(({ card, index }) => (
              <View key={index} style={styles.why}>
                <Text style={styles.whyTitle}>
                  {card.text}: {body.groups[card.group]?.title}
                </Text>
                {card.why ? <Text style={styles.sub}>{card.why}</Text> : null}
              </View>
            ))}
            <Explain piece={piece} player={player} />
          </Answer>
        )}
      </>
    );
  }

  if (body.type === "order") {
    const done = state.chain.length === body.items.length;
    const right = state.chain.every((item, position) => item === position);
    return (
      <>
        {body.context ? <FaceView face={body.context} size="big" /> : null}
        {state.chain.map((item, position) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={
              done
                ? body.items[item]!.text
                : `Take ${body.items[item]!.text} out`
            }
            disabled={done}
            onPress={() =>
              update({ chain: state.chain.filter((entry) => entry !== item) })
            }
            style={[
              styles.placed,
              done && (item === position ? styles.good : styles.bad),
            ]}
          >
            <Text style={styles.position}>{position + 1}</Text>
            <Text style={styles.placedText}>{body.items[item]!.text}</Text>
          </Pressable>
        ))}
        {body.shuffled
          .filter((item) => !state.chain.includes(item))
          .map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => update({ chain: [...state.chain, item] })}
              style={({ pressed }) => [
                styles.toPlace,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.toPlaceText}>{body.items[item]!.text}</Text>
            </Pressable>
          ))}
        {state.chain.length === 0 ? (
          <Text style={styles.hint}>Tap them in the order they come.</Text>
        ) : null}
        {done && (
          <Answer>
            <Verdict ok={right}>
              {right ? "Right order" : "Not quite. The order from class:"}
            </Verdict>
            {!right &&
              body.items.map((item, index) => (
                <Text key={index} style={styles.explain}>
                  {index + 1}. {item.text}
                </Text>
              ))}
            <Explain piece={piece} player={player} />
          </Answer>
        )}
      </>
    );
  }

  // A number to work out.
  const correct = answerMatches(state.typed, body.answer);
  return (
    <>
      {body.context ? <FaceView face={body.context} size="big" /> : null}
      <View style={styles.numberRow}>
        <TextInput
          accessibilityLabel="Your answer"
          editable={!state.revealed}
          keyboardType={
            Platform.OS === "ios" ? "numbers-and-punctuation" : "default"
          }
          onChangeText={(typed) => update({ typed })}
          onSubmitEditing={() => {
            if (state.typed.trim()) update({ revealed: true });
          }}
          placeholder="Your answer"
          placeholderTextColor={Focus.muted}
          returnKeyType="done"
          style={styles.numberInput}
          value={state.typed}
        />
        {!state.revealed ? (
          <Primary
            label="Check"
            disabled={!state.typed.trim()}
            onPress={() => update({ revealed: true })}
          />
        ) : null}
      </View>
      {body.steps.length > 0 && (
        <View style={styles.numberSteps}>
          <Text style={styles.label}>Stuck? One step at a time</Text>
          {body.steps.map((step, index) => (
            <View key={index} style={styles.numberStep}>
              <Text style={styles.position}>{index + 1}</Text>
              <Text style={[styles.explain, styles.flex]}>
                {index < state.steps || state.revealed
                  ? step.latex
                    ? latexToText(step.latex)
                    : step.text
                  : "Hidden"}
              </Text>
            </View>
          ))}
          {state.steps < body.steps.length && !state.revealed ? (
            <Quiet
              label="Show the next step"
              onPress={() => update({ steps: state.steps + 1 })}
            />
          ) : null}
        </View>
      )}
      {state.revealed && (
        <Answer>
          <Verdict ok={correct}>
            {correct ? body.answerText : `Not quite: ${body.answerText}`}
          </Verdict>
          {piece.written ? (
            <Text style={styles.sub}>
              The AI wrote the sum; Mirna worked it out.
            </Text>
          ) : null}
          <Explain piece={piece} player={player} />
        </Answer>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  face: { gap: 4 },
  hero: {
    fontFamily: FontFamily.heading,
    fontSize: 40,
    lineHeight: 50,
    color: Focus.text,
  },
  big: {
    fontFamily: FontFamily.heading,
    fontSize: 24,
    lineHeight: 32,
    color: Focus.text,
  },
  body: { ...Typography.body, color: Focus.text },
  formula: { fontFamily: FontFamily.mono },
  struck: { color: Focus.bad, textDecorationLine: "line-through" },
  reading: { ...Typography.body, color: Focus.accent },
  sub: { ...Typography.caption, color: Focus.muted },
  hint: { ...Typography.caption, color: Focus.muted },
  label: {
    ...Typography.captionStrong,
    color: Focus.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  explain: { ...Typography.body, color: Focus.text },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  primary: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.accent,
  },
  primaryLabel: { ...Typography.bodyStrong, color: Focus.onAccent },
  quiet: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
  },
  quietLabel: { ...Typography.bodyStrong, color: Focus.text },
  answer: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Focus.border,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.answer,
  },
  verdict: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 10,
  },
  verdictText: { ...Typography.bodyStrong, color: Focus.text, flex: 1 },
  good: { borderColor: Focus.good, backgroundColor: Focus.goodSurface },
  bad: { borderColor: Focus.bad, backgroundColor: Focus.badSurface },
  faded: { opacity: 0.55 },
  gradeRow: { flexDirection: "row", gap: Spacing.xs, marginTop: Spacing.xs },
  grade: { flex: 1, paddingHorizontal: Spacing.xs },
  clips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  clip: {
    minHeight: 40,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 20,
  },
  clipLabel: { ...Typography.caption, color: Focus.text, flexShrink: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 14,
  },
  chipNow: { borderColor: Focus.accent, backgroundColor: Focus.answer },
  chipGood: { borderColor: Focus.good },
  chipBad: { borderColor: Focus.bad },
  chipText: { ...Typography.caption, color: Focus.text },
  flashcard: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Focus.border,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.background,
  },
  context: {
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Focus.border,
    borderRadius: Radius.card,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Focus.background,
  },
  options: { gap: Spacing.xs },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 12,
  },
  optionNumber: {
    width: 24,
    textAlign: "center",
    fontFamily: FontFamily.mono,
    fontSize: 12,
    color: Focus.muted,
  },
  optionFace: { flex: 1 },
  sortCard: {
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Focus.line,
    borderRadius: 12,
  },
  sortText: { ...Typography.body, color: Focus.text },
  sortButtons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sortButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 10,
  },
  sortButtonText: { ...Typography.captionStrong, color: Focus.text },
  group: {
    minHeight: 64,
    gap: 6,
    padding: Spacing.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Focus.line,
    borderRadius: 14,
    backgroundColor: Focus.background,
  },
  groupTitle: { ...Typography.bodyStrong, color: Focus.text },
  placed: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 10,
    backgroundColor: Focus.answer,
  },
  placedText: { ...Typography.body, color: Focus.text, flex: 1 },
  toPlaceText: { ...Typography.body, color: Focus.text },
  toPlace: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Focus.line,
    borderRadius: 10,
  },
  position: {
    width: 24,
    textAlign: "center",
    ...Typography.captionStrong,
    color: Focus.accent,
  },
  why: {
    gap: 2,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Focus.border,
    borderRadius: 12,
    backgroundColor: Focus.background,
  },
  whyTitle: { ...Typography.bodyStrong, color: Focus.text },
  numberRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  numberInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Focus.line,
    borderRadius: 10,
    backgroundColor: Focus.background,
    color: Focus.text,
    fontFamily: FontFamily.mono,
    fontSize: 18,
  },
  numberSteps: { gap: Spacing.xs },
  numberStep: { flexDirection: "row", gap: Spacing.xs },
});
