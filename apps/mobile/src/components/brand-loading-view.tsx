import { StyleSheet, useColorScheme, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Colors, DarkColors, Typography } from "@/constants/theme";
import { useMountEffect } from "@/lib/use-mount-effect";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// The native splash shows the app icon; this view follows it with the "mirna"
// wordmark alone, so the icon and wordmark never appear together.
export function BrandLoadingView({
  animated = false,
  onAnimationComplete,
}: {
  animated?: boolean;
  onAnimationComplete?: () => void;
}) {
  // Follows the system appearance, like the native splash screen before it.
  const palette = useColorScheme() === "dark" ? DarkColors : Colors;
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animated && !reducedMotion;
  const opacity = useSharedValue(shouldAnimate ? 0 : 1);
  const translateY = useSharedValue(shouldAnimate ? 6 : 0);

  useMountEffect(() => {
    if (!shouldAnimate) {
      onAnimationComplete?.();
      return;
    }

    translateY.set(withTiming(0, { duration: 420, easing: EASE_OUT }));
    opacity.set(
      withSequence(
        withTiming(1, { duration: 420, easing: EASE_OUT }),
        // Hold the wordmark briefly before the app appears.
        withDelay(
          280,
          withTiming(1, { duration: 1 }, (finished) => {
            if (finished && onAnimationComplete) {
              scheduleOnRN(onAnimationComplete);
            }
          }),
        ),
      ),
    );

    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
    };
  });

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: translateY.get() }],
  }));

  return (
    <View
      accessible
      accessibilityLabel="Loading Mirna"
      accessibilityRole="progressbar"
      style={[styles.container, { backgroundColor: palette.brandBackgroundTop }]}
    >
      <Animated.Text
        style={[styles.wordmark, { color: palette.primary }, wordmarkStyle]}
      >
        mirna
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: Typography.wordmark,
});
