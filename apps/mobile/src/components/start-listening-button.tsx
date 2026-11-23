import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text } from "react-native";

import { CornerCurve, FontFamily, Spacing } from "@/constants/theme";
import { createStyleHook, useColors } from "@/settings/theme-provider";

const BUTTON_HEIGHT = 56;

export function StartListeningButton({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const Colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start recording"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Ionicons name="mic-outline" size={22} color={Colors.primaryForeground} />
      <Text style={styles.label}>Start recording</Text>
    </Pressable>
  );
}

const useStyles = createStyleHook((Colors) => ({
  button: {
    height: BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    borderRadius: BUTTON_HEIGHT / 2,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.primary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  label: {
    fontFamily: FontFamily.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: Colors.primaryForeground,
  },
}));
