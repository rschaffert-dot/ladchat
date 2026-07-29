import { Colors } from "@/constants/theme";
import { useThemeMode } from "@/lib/themeMode";

export const BRAND = "#3D5AFE"; // Signal Blue — primär accent
export const DANGER = "#FF4C29"; // Ember — het accent, används sparsamt
export const EMBER = "#FF4C29";
export const MINT = "#00B884"; // online-status, positiva bekräftelser
export const INK = "#15151B";
export const PAPER = "#F5F4F0";
export const LINE = "#E1DED5";

/**
 * Aktuell temapalett + accentfärger. Schemat styrs av ThemeModeProvider
 * (Ljust/Mörkt/Systemet, valt i profilen) — inte direkt av OS:et.
 */
export function useColors() {
  const { scheme } = useThemeMode();
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
