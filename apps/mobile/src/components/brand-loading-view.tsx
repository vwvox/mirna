import { Image } from "expo-image";
import { useEffect, useEffectEvent, useRef } from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { MirnaWordmark } from "@/components/mirna-wordmark";
import { Colors, DarkColors } from "@/constants/theme";
import { useMountEffect } from "@/lib/use-mount-effect";

// The system splash (expo-splash-screen in app.json) shows
// assets/images/splash-wordmark*.png: this wordmark at 56 dp, centred in a
// 164 dp wide image that Android centres on the screen. Drawing the same
// wordmark at the same size, centred, makes the hand-over invisible.
const SIZE = 56;
const MIST_WIDTH = SIZE * 2.6;
const MIST_HEIGHT = SIZE * 0.17;
const MIST_GAP = SIZE * 0.04;

// Rendered from the same drawing as the splash image, so the stroke matches.
const MIST = {
  light: require("../../assets/images/splash-mist.png"),
  dark: require("../../assets/images/splash-mist-dark.png"),
};

const DIM_AFTER_MS = 800;
const DIM_MS = 300;
const DIMMED = 0.3;
const SWEEP_MS = 2400;
const SWEEP_FADE_MS = 180;
const EASE_OUT = Easing.out(Easing.ease);
// CSS ease-in-out, as in the Mac's logo-shimmer-sweep.
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

// The Mac masks the mist with a soft band (transparent, opaque, transparent
// across 62% of its width) that travels from off the left edge to off the
// right. Without a mask library the band is built from nested clipped windows
// over the full-colour mist; their opacities stack to the band's average
// strength in each step: 1/8, 3/8, 5/8, 7/8.
const SWEEP_FROM = -0.34 * MIST_WIDTH;
const SWEEP_TO = 1.34 * MIST_WIDTH;
const SWEEP_BANDS = [
  { halfWidth: 0.308 * MIST_WIDTH, opacity: 1 / 8 },
  { halfWidth: 0.231 * MIST_WIDTH, opacity: 2 / 7 },
  { halfWidth: 0.154 * MIST_WIDTH, opacity: 2 / 5 },
  { halfWidth: 0.077 * MIST_WIDTH, opacity: 2 / 3 },
];

/**
 * The wordmark shown while Mirna starts. It takes over from the system splash
 * without moving. If loading takes a while, the mist line dims and a highlight
 * sweeps across it; once `ready`, the mist returns to full colour and `onDone`
 * lets the app appear.
 */
export function BrandLoadingView({
  ready = false,
  onDone,
}: {
  ready?: boolean;
  onDone?: () => void;
}) {
  // Follows the system appearance, like the system splash before it.
  const isDark = useColorScheme() === "dark";
  const palette = isDark ? DarkColors : Colors;
  const mistSource = isDark ? MIST.dark : MIST.light;
  const reducedMotion = useReducedMotion();
  const mist = useSharedValue(1);
  const sweep = useSharedValue(0);
  const sweepOpacity = useSharedValue(1);
  const shownAt = useRef(0);
  const done = useEffectEvent(() => onDone?.());

  useMountEffect(() => {
    shownAt.current = Date.now();
    return () => {
      cancelAnimation(mist);
      cancelAnimation(sweep);
      cancelAnimation(sweepOpacity);
    };
  });

  useEffect(() => {
    const elapsed = Date.now() - shownAt.current;
    if (!ready) {
      if (reducedMotion) return;
      const dimDelay = Math.max(0, DIM_AFTER_MS - elapsed);
      mist.set(
        withDelay(
          dimDelay,
          withTiming(DIMMED, { duration: DIM_MS, easing: EASE_OUT }),
        ),
      );
      sweep.set(
        withDelay(
          dimDelay + DIM_MS,
          withRepeat(
            withTiming(1, { duration: SWEEP_MS, easing: EASE_IN_OUT }),
            -1,
            false,
          ),
        ),
      );
      return;
    }
    // Ready before the mist dimmed: nothing to undo.
    if (reducedMotion || elapsed < DIM_AFTER_MS) {
      cancelAnimation(mist);
      cancelAnimation(sweep);
      mist.set(1);
      done();
      return;
    }
    sweepOpacity.set(withTiming(0, { duration: SWEEP_FADE_MS }));
    mist.set(
      withTiming(1, { duration: DIM_MS, easing: EASE_OUT }, (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
  }, [ready, reducedMotion, mist, sweep, sweepOpacity]);

  const mistStyle = useAnimatedStyle(() => ({ opacity: mist.get() }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweepOpacity.get(),
  }));

  return (
    <View
      accessible
      accessibilityLabel="Loading Mirna"
      accessibilityRole="progressbar"
      style={[
        styles.container,
        { backgroundColor: palette.brandBackgroundTop },
      ]}
    >
      <View style={styles.wordmark}>
        <MirnaWordmark size={SIZE} align="center" mist={false} dark={isDark} />
        <View style={styles.mist}>
          <Animated.View style={[StyleSheet.absoluteFill, mistStyle]}>
            <Image
              source={mistSource}
              contentFit="fill"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {reducedMotion ? null : (
            <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
              {SWEEP_BANDS.map((band) => (
                <SweepBand
                  key={band.halfWidth}
                  halfWidth={band.halfWidth}
                  opacity={band.opacity}
                  progress={sweep}
                  source={mistSource}
                />
              ))}
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

// A clipped window that slides along the mist, holding the full-colour mist
// shifted the other way so it lines up with the dimmed one underneath.
function SweepBand({
  halfWidth,
  opacity,
  progress,
  source,
}: {
  halfWidth: number;
  opacity: number;
  progress: SharedValue<number>;
  source: number;
}) {
  const windowStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          interpolate(progress.get(), [0, 1], [SWEEP_FROM, SWEEP_TO]) -
          halfWidth,
      },
    ],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          halfWidth -
          interpolate(progress.get(), [0, 1], [SWEEP_FROM, SWEEP_TO]),
      },
    ],
  }));
  return (
    <Animated.View
      style={[styles.band, { width: halfWidth * 2, opacity }, windowStyle]}
    >
      <Animated.View style={[styles.bandContent, contentStyle]}>
        <Image
          source={source}
          contentFit="fill"
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    alignItems: "center",
  },
  mist: {
    width: MIST_WIDTH,
    height: MIST_HEIGHT,
    marginTop: MIST_GAP,
  },
  band: {
    position: "absolute",
    left: 0,
    top: 0,
    height: MIST_HEIGHT,
    overflow: "hidden",
  },
  bandContent: {
    width: MIST_WIDTH,
    height: MIST_HEIGHT,
  },
});
