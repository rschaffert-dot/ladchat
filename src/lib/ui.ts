import { useColorScheme } from "react-native";
import { Colors } from "@/constants/theme";

export const BRAND = "#D97757";
export const DANGER = "#dc2626";

/** Aktuell temapalett + brand-färg. */
export function useColors() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { ...Colors[scheme], brand: BRAND, danger: DANGER, scheme };
}
