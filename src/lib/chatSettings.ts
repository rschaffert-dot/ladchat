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

export type ChatSettings = {
  color: string;
  background: string;
  backgroundImage: string;
  // Kosmetisk etikett för poäng — själva poängen lagras server-side (group_members.points).
  currency: Currency;
  soundEnabled: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  color: "#4f46e5",
  background: "",
  backgroundImage: "",
  currency: "Douchepoints",
  soundEnabled: true,
};

export const COLOR_OPTIONS = [
  "#4f46e5",
  "#dc2626",
  "#059669",
  "#d97706",
  "#0891b2",
  "#db2777",
];

export const BACKGROUND_OPTIONS = [
  { label: "Standard", value: "" },
  { label: "Ljusgrå", value: "#f1f5f9" },
  { label: "Varm", value: "#fef3c7" },
  { label: "Mint", value: "#ecfdf5" },
  { label: "Himmel", value: "#eff6ff" },
  { label: "Mörk", value: "#1e1b2e" },
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
