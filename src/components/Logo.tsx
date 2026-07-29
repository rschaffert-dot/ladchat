import { StyleSheet, Text, View } from "react-native";

import { Fonts } from "@/constants/theme";
import { BRAND, EMBER, INK } from "@/lib/ui";

/**
 * Ladchat-logotypen: två överlappande fyrkanter i outline (Signal Blue +
 * Ember) och ordmärket "LadChat", Space Grotesk 700.
 *
 * Varianter: "primary" (ljus bakgrund — blå/ember ikon, Ink-text) och
 * "hero" (på Signal Blue-yta — vit/Ink-ikon, vit text).
 */
export function Logo({
  size = 30,
  variant = "primary",
  showWordmark = true,
}: {
  size?: number;
  variant?: "primary" | "hero";
  showWordmark?: boolean;
}) {
  const squareSize = size * (10 / 24);
  const offset = size * (8 / 24);
  const stroke = Math.max(1.6, size * (1.6 / 24));
  const firstColor = variant === "hero" ? "#FFFFFF" : BRAND;
  const secondColor = variant === "hero" ? INK : EMBER;
  const textColor = variant === "hero" ? "#FFFFFF" : INK;

  return (
    <View style={styles.row}>
      <View style={{ width: size, height: size }}>
        <View
          style={{
            position: "absolute",
            top: size * (3 / 24),
            left: size * (3 / 24),
            width: squareSize,
            height: squareSize,
            borderWidth: stroke,
            borderColor: firstColor,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: size * (3 / 24) + offset,
            left: size * (3 / 24) + offset,
            width: squareSize,
            height: squareSize,
            borderWidth: stroke,
            borderColor: secondColor,
          }}
        />
      </View>
      {showWordmark ? (
        <Text
          style={[
            styles.wordmark,
            { color: textColor, fontSize: size * 0.8, fontFamily: Fonts?.display },
          ]}
        >
          LadChat
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" },
  wordmark: { fontWeight: "700", letterSpacing: -0.5 },
});
