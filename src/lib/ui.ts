import { useColorScheme } from "react-native";
import { Colors } from "@/constants/theme";

export const BRAND = "#3D5AFE"; // Signal Blue — primär accent
export const DANGER = "#FF4C29"; // Ember — het accent, används sparsamt
export const EMBER = "#FF4C29";
export const MINT = "#00B884"; // online-status, positiva bekräftelser
export const INK = "#15151B";
export const PAPER = "#F5F4F0";
export const LINE = "#E1DED5";

/** Aktuell temapalett + accentfärger. */
export function useColors() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return {
    ...Colors[scheme],
    brand: BRAND,
    danger: DANGER,
    ember: EMBER,
    mint: MINT,
    ink: INK,
    line: LINE,
    scheme,
  };
}
