import { Pressable, Text, View } from "react-native";

import { CornerCurve, FontFamily, Spacing } from "@/constants/theme";
import { createStyleHook } from "@/settings/theme-provider";

/** Summary, Notes and Transcript. */
export function NoteTabs({
  labels,
  selectedIndex,
  onChange,
}: {
  labels: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  const styles = useStyles();
  return (
    <View
      accessibilityLabel="Note sections"
      accessibilityRole="tablist"
      style={styles.tabs}
    >
      {labels.map((label, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (!selected) onChange(index);
            }}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.tabSelected,
              pressed && !selected && styles.tabPressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, selected && styles.labelSelected]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createStyleHook((Colors) => ({
  tabs: {
    flexDirection: "row",
    gap: Spacing.xs,
    padding: Spacing.xs,
    borderRadius: 14,
    borderCurve: CornerCurve.squircle,
    backgroundColor: Colors.mutedSurface,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
    borderRadius: 10,
    borderCurve: CornerCurve.squircle,
  },
  tabSelected: {
    backgroundColor: Colors.surface,
    boxShadow: "0px 1px 2px rgba(47, 52, 49, 0.12)",
  },
  tabPressed: { opacity: 0.7 },
  label: {
    fontFamily: FontFamily.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
    color: Colors.muted,
  },
  labelSelected: {
    fontWeight: "600",
    color: Colors.ink,
  },
}));
