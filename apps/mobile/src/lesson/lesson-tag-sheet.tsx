import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BottomSheet } from "@/components/bottom-sheet";
import { CornerCurve, Radius, Spacing, Typography } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import type { CourseInfo, LessonTag } from "@/mac-link/model";
import { usePairedMac } from "@/mac-link/pairing";
import { useMacCourses } from "@/mac-link/schedule";
import { tagRecording } from "@/mac-link/sender";
import { useMacLinkStatus } from "@/mac-link/status";
import { LANGUAGE_CODES, languageName } from "@/settings/languages";
import { usePreferences } from "@/settings/preferences";
import { createStyleHook, useColors } from "@/settings/theme-provider";

import {
  findCourse,
  isValidTag,
  type LessonSubject,
  nextLessonNumber,
  SUBJECTS,
  tagForCourse,
} from "./lesson-model";
import type { PhoneLesson } from "./use-lesson";

/**
 * "What was this?" for a recording made on this phone: a note, or a lesson
 * in one of the Mac's courses (or a new one). The Mac then files it, writes
 * its study sheet and plans its review, with no setup there.
 */
export function LessonTagSheet({
  sessionId,
  lesson,
  recording,
  visible,
  onClose,
}: {
  sessionId: string;
  lesson: PhoneLesson | null;
  /** Still recording: the choice goes with the recording when it stops. */
  recording: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  // Loaded before the sheet opens, so the form starts in the right course.
  const courses = useMacCourses();
  return (
    <BottomSheet visible={visible} title="What was this?" onClose={onClose}>
      {visible && (
        <TagForm
          sessionId={sessionId}
          lesson={lesson}
          courses={courses}
          recording={recording}
          onDone={onClose}
        />
      )}
    </BottomSheet>
  );
}

function initialTag(
  lesson: PhoneLesson | null,
  courses: CourseInfo[],
  languages: { main: string; spoken: string[] },
): LessonTag {
  if (lesson?.tag?.lesson) return lesson.tag.lesson;
  const settings = lesson?.isLesson ? lesson.settings : null;
  if (settings) {
    return {
      course: lesson?.mac?.course ?? "",
      subject: settings.subject ?? "language",
      learning: settings.learning,
      explain_in: settings.explainIn,
      subject_name: settings.subjectName ?? null,
    };
  }
  if (courses[0]) return tagForCourse(courses[0]);
  return {
    course: "",
    subject: "language",
    learning:
      languages.spoken.find((code) => code !== languages.main) ??
      languages.main,
    explain_in: languages.main,
    subject_name: null,
  };
}

function TagForm({
  sessionId,
  lesson,
  courses,
  recording,
  onDone,
}: {
  sessionId: string;
  lesson: PhoneLesson | null;
  courses: CourseInfo[];
  recording: boolean;
  onDone: () => void;
}) {
  const styles = useStyles();
  const Colors = useColors();
  const preferences = usePreferences();
  const { mac } = usePairedMac();
  const link = useMacLinkStatus(sessionId);
  const macName = mac?.mac_name || "your Mac";
  // Opened to make it a lesson, unless it was said to be a note.
  const [isLesson, setIsLesson] = useState(
    lesson?.tag ? lesson.tag.lesson !== null : true,
  );
  const [tag, setTag] = useState<LessonTag>(() =>
    initialTag(lesson, courses, {
      main: preferences.ai_language,
      spoken: preferences.spoken_languages,
    }),
  );
  const [allLanguages, setAllLanguages] = useState(false);
  const known = findCourse(courses, tag.course);
  const single = tag.subject !== "language";
  const valid = !isLesson || isValidTag(tag);
  const number = nextLessonNumber(courses, tag.course);

  const save = useMutation({
    mutationFn: () =>
      tagRecording(
        sessionId,
        isLesson
          ? {
              ...tag,
              course: tag.course.trim(),
              explain_in: single ? tag.learning : tag.explain_in,
              subject_name: single ? tag.subject_name?.trim() || null : null,
            }
          : null,
        { sync: !recording },
      ),
    onSuccess: ({ sent }) => {
      const onPhone =
        !link || link.state === "waiting" || link.state === "sending";
      showToast({
        id: `lesson-tag-${sessionId}`,
        title: isLesson ? "Saved as a lesson" : "Saved as a note",
        description: !mac
          ? "Pair your Mac in Settings › Mac to get the study sheet."
          : recording || (onPhone && !sent)
            ? `It goes to ${macName} with the recording.`
            : sent
              ? isLesson
                ? `${capitalize(macName)} is writing the study sheet and the review. They come back here.`
                : `${capitalize(macName)} makes it a normal note again.`
              : `${capitalize(macName)} hears it at the next sync.`,
      });
      onDone();
    },
    onError: () => {
      showToast({
        id: `lesson-tag-${sessionId}`,
        title: "Couldn’t save that",
        description: "Nothing changed. Try again.",
      });
    },
  });

  const pickCourse = (course: CourseInfo) => setTag(tagForCourse(course));
  const languageCodes = allLanguages
    ? [...LANGUAGE_CODES].sort((a, b) =>
        languageName(a).localeCompare(languageName(b)),
      )
    : [
        ...new Set([
          tag.learning,
          tag.explain_in,
          preferences.ai_language,
          ...preferences.spoken_languages,
          ...courses.flatMap((course) => [course.learning, course.explain_in]),
        ]),
      ].filter(Boolean);

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <View accessibilityRole="radiogroup" style={styles.row}>
          {[
            { value: false, label: "A note" },
            { value: true, label: "A lesson" },
          ].map((option) => (
            <Choice
              key={option.label}
              label={option.label}
              selected={isLesson === option.value}
              onPress={() => setIsLesson(option.value)}
              style={styles.half}
            />
          ))}
        </View>

        {isLesson && (
          <>
            <Field
              label="Course"
              detail={
                courses.length > 0
                  ? `From ${macName}’s courses, or start a new one`
                  : "A new course: name it as you’d like it on your Mac"
              }
            >
              {courses.length > 0 && (
                <View style={styles.wrap}>
                  {courses.map((course) => (
                    <Choice
                      key={course.name}
                      label={course.name}
                      selected={known?.name === course.name}
                      onPress={() => pickCourse(course)}
                    />
                  ))}
                </View>
              )}
              <TextInput
                accessibilityLabel="Course name"
                autoCapitalize="words"
                onChangeText={(course) =>
                  setTag((value) => ({ ...value, course }))
                }
                placeholder={
                  courses.length > 0
                    ? "Or a new course"
                    : "For example Mandarin with Lǎoshī Chen"
                }
                placeholderTextColor={Colors.muted}
                returnKeyType="done"
                style={styles.input}
                value={tag.course}
              />
            </Field>

            <Field label="Kind of class">
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                {SUBJECTS.map((subject) => (
                  <Choice
                    key={subject.subject}
                    label={subject.label}
                    selected={tag.subject === subject.subject}
                    onPress={() =>
                      setTag((value) => ({
                        ...value,
                        subject: subject.subject as LessonSubject,
                      }))
                    }
                  />
                ))}
              </View>
              <Text style={styles.detail}>
                {
                  SUBJECTS.find((subject) => subject.subject === tag.subject)
                    ?.detail
                }
              </Text>
            </Field>

            {single && (
              <Field label="About">
                <TextInput
                  accessibilityLabel="What the class is about"
                  onChangeText={(subject_name) =>
                    setTag((value) => ({ ...value, subject_name }))
                  }
                  placeholder="For example Contract law, or Statistics"
                  placeholderTextColor={Colors.muted}
                  style={styles.input}
                  value={tag.subject_name ?? ""}
                />
              </Field>
            )}

            <Field label={single ? "Taught in" : "Learning"}>
              <View style={styles.wrap}>
                {languageCodes.map((code) => (
                  <Choice
                    key={code}
                    label={languageName(code)}
                    selected={tag.learning === code}
                    onPress={() =>
                      setTag((value) => ({ ...value, learning: code }))
                    }
                  />
                ))}
              </View>
            </Field>
            {!single && (
              <Field label="Explained in">
                <View style={styles.wrap}>
                  {languageCodes.map((code) => (
                    <Choice
                      key={code}
                      label={languageName(code)}
                      selected={tag.explain_in === code}
                      onPress={() =>
                        setTag((value) => ({ ...value, explain_in: code }))
                      }
                    />
                  ))}
                </View>
              </Field>
            )}
            {!allLanguages && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAllLanguages(true)}
                style={({ pressed }) => [
                  styles.more,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.moreLabel}>More languages</Text>
              </Pressable>
            )}

            {tag.course.trim() && (
              <Text style={styles.becomes}>
                It becomes{" "}
                <Text style={styles.becomesStrong}>
                  {lesson?.mac?.number &&
                  lesson.mac.course === tag.course.trim()
                    ? `Lesson ${lesson.mac.number}`
                    : `Lesson ${number}`}
                </Text>{" "}
                in {tag.course.trim()} on {macName}. It transcribes it, writes
                the study sheet and plans the review, then sends them back here
                with the teacher’s clips.
              </Text>
            )}
          </>
        )}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        disabled={!valid || save.isPending}
        onPress={() => save.mutate()}
        style={({ pressed }) => [
          styles.primary,
          (pressed || !valid || save.isPending) && styles.pressed,
        ]}
      >
        <Text style={styles.primaryLabel}>
          {save.isPending ? "Saving…" : "Save"}
        </Text>
      </Pressable>
    </>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Field({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {children}
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: object;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        style,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyleHook((Colors) => ({
  scroll: { maxHeight: 480 },
  form: { gap: Spacing.md, paddingBottom: Spacing.sm },
  row: { flexDirection: "row", gap: Spacing.sm },
  half: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  field: { gap: 6 },
  label: { ...Typography.captionStrong, color: Colors.ink },
  detail: { ...Typography.caption, color: Colors.muted },
  input: {
    ...Typography.body,
    minHeight: 44,
    paddingHorizontal: Spacing.compact,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    color: Colors.ink,
    backgroundColor: Colors.surface,
  },
  choice: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.compact,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
  },
  choiceSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.accentSurface,
  },
  choiceLabel: { ...Typography.body, color: Colors.ink },
  choiceLabelSelected: { fontWeight: "600" },
  more: { alignSelf: "flex-start", paddingVertical: 4 },
  moreLabel: { ...Typography.captionStrong, color: Colors.primary },
  becomes: { ...Typography.caption, color: Colors.muted },
  becomesStrong: { ...Typography.captionStrong, color: Colors.ink },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.control,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.primary,
  },
  primaryLabel: { ...Typography.bodyStrong, color: Colors.primaryForeground },
  pressed: { opacity: 0.6 },
}));
