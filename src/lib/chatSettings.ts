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

// 15-minutersintervaller. Kortare tidsgräns = svårare utmaning = högre belöning.
export const BEER_DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120];

export const BEER_DURATION_REWARDS: Record<number, number> = {
  15: 25,
  30: 12,
  45: 8,
  60: 5,
  75: 4,
  90: 3,
  105: 2,
  120: 1,
};

export type ChatSettings = {
  color: string;
  background: string;
  backgroundImage: string;
  beerMode: boolean;
  beerDurationMinutes: number;
  // Epoch ms för när innevarande öl-mode-runda startade, eller null om ingen runda pågår.
  beerStartedAt: number | null;
  // Totala meddelandeantalet i chatten när rundan startade, för att räkna "från det att den aktiveras".
  beerBaselineCount: number;
  currency: Currency;
  currencyPoints: number;
  soundEnabled: boolean;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  color: "#4f46e5",
  background: "",
  backgroundImage: "",
  beerMode: false,
  beerDurationMinutes: 15,
  beerStartedAt: null,
  beerBaselineCount: 0,
  currency: "Douchepoints",
  currencyPoints: 0,
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
