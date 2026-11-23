import { Image } from "expo-image";
import { Text, type TextStyle, useColorScheme, View } from "react-native";

import { FontFamily, MirnaColors } from "@/constants/theme";

const MIST = {
  light: require("../../assets/images/mirna-mist.png"),
  dark: require("../../assets/images/mirna-mist-dark.png"),
};

// Fraunces' vertical metrics (hhea and OS/2 agree): ascent 0.978 em, descent
// 0.255 em. Android and iOS both centre the glyphs in their line box, like CSS,
// once the line height is at least ascent + descent (1.233 em); below that iOS
// pins them to the bottom instead. So the letters get a 1.25 em line box and
// negative margins trim it back to the design's 1 em box (line-height: 1). The
// baseline then sits 0.8615 em from the top on both platforms, and the ipê dot
// can use the design's 0.06 em offset.
const LINE_BOX = 1.25;
const DOT_SIZE = 0.19;
const DOT_TOP = 0.06;
// The mist is drawn in a 250 × 16 viewBox, centred in a 2.6 em × 0.17 em box.
const MIST_WIDTH = 2.6;
const MIST_BOX = 0.17;
const MIST_HEIGHT = (MIST_WIDTH * 16) / 250;
const MIST_GAP = 0.04;

/**
 * Mirna's in-app wordmark: lowercase Fraunces "mirna" with an ipê-sun dot on
 * the i and the mist line (sage, red earth, sage) underneath. The app icon is
 * used outside the app; the two never appear together.
 */
export function MirnaWordmark({
  size = 32,
  align = "flex-start",
  mist = true,
  dark,
  color,
}: {
  /** Font size of the letters, in points. */
  size?: number;
  align?: "flex-start" | "center";
  mist?: boolean;
  /** Force light or dark colours; follows the system when omitted. */
  dark?: boolean;
  color?: string;
}) {
  const scheme = useColorScheme();
  const isDark = dark ?? scheme === "dark";
  const ink = color ?? (isDark ? MirnaColors.mist : MirnaColors.serra);
  const lineHeight = Math.ceil(size * LINE_BOX);
  const letters: TextStyle = {
    fontFamily: FontFamily.heading,
    fontWeight: "400",
    fontSize: size,
    lineHeight,
    marginVertical: (size - lineHeight) / 2,
    letterSpacing: -0.015 * size,
    color: ink,
    includeFontPadding: false,
  };
  const dot = size * DOT_SIZE;
  const mistInset = (size * (MIST_BOX - MIST_HEIGHT)) / 2;
  return (
    <View
      accessible
      accessibilityLabel="Mirna"
      accessibilityRole="image"
      style={{ alignItems: align }}
    >
      <View style={{ flexDirection: "row" }}>
        <Text style={letters}>m</Text>
        <View>
          <Text style={letters}>ı</Text>
          <View
            style={{
              position: "absolute",
              left: "50%",
              top: size * DOT_TOP,
              width: dot,
              height: dot,
              marginLeft: -dot / 2,
              borderRadius: dot / 2,
              backgroundColor: MirnaColors.ipe,
            }}
          />
        </View>
        <Text style={letters}>rna</Text>
      </View>
      {mist ? (
        <Image
          source={isDark ? MIST.dark : MIST.light}
          contentFit="fill"
          style={{
            width: size * MIST_WIDTH,
            height: size * MIST_HEIGHT,
            marginTop: size * MIST_GAP + mistInset,
            marginBottom: mistInset,
          }}
        />
      ) : null}
    </View>
  );
}
