/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Ladchat-profilen: ljus, minimal och strukturerad — Paper som grund,
 * Ink för text/mörka ytor, 1px Line-kanter i stället för skuggor,
 * Signal Blue som primär accent och Ember sparsamt som "het" detalj.
 * Appen är ljus i grunden, så båda schemana använder samma palett.
 */
const palette = {
  text: '#15151B', // Ink
  background: '#F5F4F0', // Paper
  backgroundElement: '#FFFFFF', // White — kort/ytor ovanpå Paper
  backgroundSelected: '#E1DED5', // Line — kantlinjer, dividers, valda ytor
  textSecondary: '#84828C', // Muted
} as const;

export const Colors = { light: palette, dark: palette } as const;

/** Semantiska accentfärger — använd dessa i stället för hex i komponenter. */
export const Accents = {
  success: '#00B884', // Mint — online-status, positiva bekräftelser
  warning: '#FF4C29', // Ember — highlights, sparsamt
  danger: '#FF4C29', // Ember — destruktiva accenter
  gold: '#D4AF37',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** Rubriker: Space Grotesk (systemfallback på native tills TTF laddas). */
    display: 'system-ui',
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    display: 'normal',
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    /** Space Grotesk — rubriker/headlines (definieras i global.css). */
    display: 'var(--font-display)',
    /** Inter — brödtext och UI (body-default i global.css). */
    sans: 'var(--font-sans)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
