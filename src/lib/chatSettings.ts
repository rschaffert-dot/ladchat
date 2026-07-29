import AsyncStorage from "@react-native-async-storage/async-storage";

export type Currency =
  | "Douchepoints"
  | "Ass points"
  | "Dick sticks"
  | "Fanny farts";

export const CURRENCY_OPTIONS: Currency[] = [
  "Douchepoints",
  "Ass points",
  "Dick sticks",
  "Fanny farts",
];

/** Subtila symboler per valuta — antyder utan att skrika. */
export const CURRENCY_META: Record<Currency, { emoji: string }> = {
  Douchepoints: { emoji: "🚿" },
  "Ass points": { emoji: "🍑" },
  "Dick sticks": { emoji: "🌭" },
  "Fanny farts": { emoji: "💨" },
};

export type ChatSettings = {
  color: string;
  background: string;
  backgroundImage: string;
  // Kosmetisk etikett för poäng — själva poängen lagras server-side (group_members.points).
  currency: Currency;
  soundEnabled: boolean;
  /** Party-Mode: mjukt pulserande discoljus bakom chatten (rent kosmetiskt). */
  partyMode: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  // Utgående bubblor är Ink som standard (profilen); övriga färger är accenter.
  color: "#15151B",
  background: "",
  backgroundImage: "",
  currency: "Douchepoints",
  soundEnabled: true,
  partyMode: false,
};

export const COLOR_OPTIONS = [
  "#15151B", // Ink (standard)
  "#3D5AFE", // Signal Blue
  "#FF4C29", // Ember
  "#00B884", // Mint
  "#D4AF37", // Guld
  "#84828C", // Muted
];

export const BACKGROUND_OPTIONS = [
  { label: "Standard", value: "" },
  { label: "Vit", value: "#FFFFFF" },
  { label: "Sand", value: "#EFEDE6" },
  { label: "Mint", value: "#E3F6EF" },
  { label: "Blå ton", value: "#E9EDFF" },
  { label: "Mörk", value: "#15151B" },
];

function storageKey(groupId: string) {
  return `ladchat_chat_settings_${groupId}`;
}

export async function loadChatSettings(groupId: string): Promise<ChatSettings> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(groupId));
    if (!raw) return DEFAULT_CHAT_SETTINGS;
    return { ...DEFAULT_CHAT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

export async function saveChatSettings(
  groupId: string,
  settings: ChatSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(groupId), JSON.stringify(settings));
  } catch {
    // Ignorera lagringsfel (t.ex. privat läge eller full kvot).
  }
}
