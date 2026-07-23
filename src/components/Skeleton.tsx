import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

/** Pulserande platshållare under laddning — känns snabbare än en spinner. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[
        { backgroundColor: "rgba(128,124,116,0.25)", borderRadius: 10, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Skelett för en chattlista-rad. */
export function SkeletonListRow() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
      <Skeleton style={{ width: 44, height: 44, borderRadius: 22 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton style={{ height: 14, width: "55%" }} />
        <Skeleton style={{ height: 11, width: "80%" }} />
      </View>
    </View>
  );
}

/** Skelett för chattbubblor. */
export function SkeletonBubbles() {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Skeleton style={{ height: 44, width: "62%", borderRadius: 18, alignSelf: "flex-start" }} />
      <Skeleton style={{ height: 36, width: "48%", borderRadius: 18, alignSelf: "flex-end" }} />
      <Skeleton style={{ height: 58, width: "70%", borderRadius: 18, alignSelf: "flex-start" }} />
      <Skeleton style={{ height: 36, width: "40%", borderRadius: 18, alignSelf: "flex-end" }} />
      <Skeleton style={{ height: 44, width: "55%", borderRadius: 18, alignSelf: "flex-start" }} />
    </View>
  );
}
