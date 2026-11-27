import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text } from "react-native";

import { Spacing, Typography } from "@/constants/theme";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import type { PhoneLesson } from "./use-lesson";

/** "Lesson 14 · Mandarin", or "Lesson in Mandarin" until the Mac has filed it. */
export function lessonLabel(lesson: PhoneLesson | null): string {
  if (!lesson?.isLesson) return "A note";
  const course = lesson.mac?.course ?? lesson.tag?.lesson?.course ?? null;
  const number = lesson.mac?.number;
  if (number && course) return `Lesson ${number} · ${course}`;
  return course ? `Lesson in ${course}` : "Lesson";
}

/** Under a lesson's title: which lesson it is, and a way to change it. */
export function LessonLine({
  lesson,
  macName,
  onPress,
}: {
  lesson: PhoneLesson | null;
  macName: string;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  if (!lesson?.isLesson) return null;
  const waiting = !lesson.sheet && !lesson.review;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityHint={
        onPress ? "Change whether this is a lesson" : undefined
      }
      disabled={!onPress}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <Ionicons name="school-outline" size={14} color={Colors.primary} />
      <Text style={styles.text} numberOfLines={1}>
        {lessonLabel(lesson)}
        {waiting ? ` · the study sheet comes from ${macName}` : ""}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyleHook((Colors) => ({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    alignSelf: "flex-start",
  },
  text: { ...Typography.captionStrong, color: Colors.primary, flexShrink: 1 },
  pressed: { opacity: 0.6 },
}));
