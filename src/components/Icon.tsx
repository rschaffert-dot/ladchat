import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import { INK } from "@/lib/ui";

export type IconName = ComponentProps<typeof Feather>["name"];

/**
 * Appens linjeikoner (Feather): stroke-baserade med runda linjeändar,
 * en färg per ikon beroende på kontext — Ink som standard, Signal Blue
 * för primära åtgärder, Mint för status, Ember för highlights.
 */
export function Icon({
  name,
  size = 20,
  color = INK,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
