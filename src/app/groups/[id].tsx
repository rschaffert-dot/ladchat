import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  NativeSyntheticEvent,
  StyleProp,
  TextInputKeyPressEventData,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import {
  BACKGROUND_OPTIONS,
  BEER_DURATION_OPTIONS,
  BEER_DURATION_REWARDS,
  COLOR_OPTIONS,
  CURRENCY_OPTIONS,
  DEFAULT_CHAT_SETTINGS,
  loadChatSettings,
  saveChatSettings,
} from "@/lib/chatSettings";
import type { ChatSettings } from "@/lib/chatSettings";
import { supabase } from "@/lib/supabase";
import type { Group, Message, MessageWithAuthor } from "@/lib/types";
import { useColors } from "@/lib/ui";

function playMessageSound() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    const AudioCtx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Ljud är en trevlig detalj, inte kritiskt — ignorera fel tyst.
  }
}

function ChatBackground({
  image,
  color,
  style,
  children,
}: {
  image: string;
  color: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (image) {
    return (
      <ImageBackground source={{ uri: image }} style={style} resizeMode="cover">
        {children}
      </ImageBackground>
    );
  }
  return <View style={[style, color ? { backgroundColor: color } : null]}>{children}</View>;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function BeerGlassBackground({
  percent,
  remainingMs,
  style,
  children,
}: {
  percent: number;
  remainingMs: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View style={[style, styles.beerBackdrop]}>
      <View style={styles.beerCountdownWrap} pointerEvents="none">
        <Text
          style={styles.beerCountdownBig}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatCountdown(remainingMs)}
        </Text>
      </View>
      <View style={styles.beerGlassWrap} pointerEvents="none">
        <Text style={styles.beerLabel}>{percent}% fullt 🍺</Text>
        <View style={styles.beerGlass}>
          <View style={[styles.beerLiquidColumn, { height: `${percent}%` }]}>
            {percent > 3 ? <View style={styles.beerFoam} /> : null}
            <View style={styles.beerLiquid} />
          </View>
        </View>
      </View>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

function BeerGlassOrChatBackground({
  beerMode,
  beerPercent,
  beerRemainingMs,
  image,
  color,
  style,
  children,
}: {
  beerMode: boolean;
  beerPercent: number;
  beerRemainingMs: number;
  image: string;
  color: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (beerMode) {
    return (
      <BeerGlassBackground percent={beerPercent} remainingMs={beerRemainingMs} style={style}>
        {children}
      </BeerGlassBackground>
    );
  }
  return (
    <ChatBackground image={image} color={color} style={style}>
      {children}
    </ChatBackground>
  );
}

const PAGE = 30;
const MISSING = "00000000-0000-0000-0000-000000000000";

export default function GroupChatScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();

  const [group, setGroup] = useState<Group | null>(null);
  // Meddelanden i fallande ordning (nyast först) för inverterad lista.
  const [messages, setMessages] = useState<MessageWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const namesRef = useRef<Record<string, string>>({});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const awardedForRoundRef = useRef<number | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beerPercent = settings.beerMode
    ? Math.max(0, Math.min(100, messageCount - settings.beerBaselineCount))
    : 0;
  const beerRemainingMs = settings.beerMode && settings.beerStartedAt
    ? Math.max(0, settings.beerStartedAt + settings.beerDurationMinutes * 60_000 - nowTick)
    : 0;

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  // Öl-mode-klockan tickar en gång i sekunden så nedräkningen syns live.
  useEffect(() => {
    if (!settings.beerMode) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settings.beerMode]);

  // Belöna med valuta när glaset blir fullt, och starta en ny runda automatiskt.
  useEffect(() => {
    if (!settings.beerMode || beerPercent < 100) return;
    if (awardedForRoundRef.current === settings.beerStartedAt) return;
    awardedForRoundRef.current = settings.beerStartedAt;
    const reward = BEER_DURATION_REWARDS[settings.beerDurationMinutes] ?? 1;
    showToast(`🍺 Glaset fullt! +${reward} ${settings.currency}`);
    void updateSettings({
      currencyPoints: settingsRef.current.currencyPoints + reward,
      beerBaselineCount: messageCount,
      beerStartedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beerPercent, settings.beerMode, settings.beerStartedAt]);

  function toggleBeerMode(on: boolean) {
    if (on) {
      void updateSettings({
        beerMode: true,
        beerStartedAt: Date.now(),
        beerBaselineCount: messageCount,
      });
    } else {
      void updateSettings({ beerMode: false });
    }
  }

  function selectBeerDuration(minutes: number) {
    void updateSettings({
      beerMode: true,
      beerDurationMinutes: minutes,
      beerStartedAt: Date.now(),
      beerBaselineCount: messageCount,
    });
  }

  const nameFor = useCallback(async (uid: string): Promise<string> => {
    if (namesRef.current[uid]) return namesRef.current[uid];
    const { data } = await supabase
      .from("profiles")
      .select("display_name,email")
      .eq("id", uid)
      .single();
    const n = data?.display_name || data?.email || "Okänd";
    namesRef.current[uid] = n;
    return n;
  }, []);

  // Initial laddning.
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    (async () => {
      const { data: g } = await supabase
        .from("groups")
        .select("id,name,owner_id,created_at")
        .eq("id", groupId)
        .single();
      if (!active) return;
      if (!g) {
        router.back();
        return;
      }
      setGroup(g as Group);

      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      const ids = (members ?? []).map((m) => m.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", ids.length ? ids : [MISSING]);
      (profs ?? []).forEach((p) => {
        namesRef.current[p.id] = p.display_name || p.email || "Okänd";
      });

      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (!active) return;
      const list = ((msgs ?? []) as Message[]).map((m) => ({
        ...m,
        author_name: namesRef.current[m.user_id] ?? "Okänd",
      }));
      setMessages(list);
      setHasMore((msgs?.length ?? 0) >= PAGE);
      setLoading(false);

      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId);
      if (active) setMessageCount(count ?? 0);
    })();
    return () => {
      active = false;
    };
  }, [groupId, router]);

  // Ladda chattens personliga utseende-/ljudinställningar (sparade lokalt per enhet).
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    void loadChatSettings(groupId).then((s) => {
      if (active) setSettings(s);
    });
    return () => {
      active = false;
    };
  }, [groupId]);

  async function updateSettings(patch: Partial<ChatSettings>) {
    if (!groupId) return;
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    await saveChatSettings(groupId, next);
  }

  async function pickBackgroundImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) return;
    const mime = asset.mimeType ?? "image/jpeg";
    await updateSettings({ backgroundImage: `data:${mime};base64,${asset.base64}` });
  }

  // Realtime.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          if (m.user_id !== userId && settingsRef.current.soundEnabled) {
            playMessageSound();
          }
          setMessageCount((n) => n + 1);
          setMessages((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [
                  { ...m, author_name: namesRef.current[m.user_id] ?? "…" },
                  ...prev,
                ],
          );
          if (!namesRef.current[m.user_id]) {
            void nameFor(m.user_id).then((n) =>
              setMessages((prev) =>
                prev.map((x) =>
                  x.id === m.id ? { ...x, author_name: n } : x,
                ),
              ),
            );
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, nameFor, userId]);

  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (Platform.OS !== "web") return;
    // På webben förmedlar react-native-web den riktiga DOM-KeyboardEvent här,
    // med fler fält (shiftKey, preventDefault) än RN:s officiella typ medger.
    const native = e.nativeEvent as unknown as KeyboardEvent;
    if (native.key === "Enter" && !native.shiftKey) {
      native.preventDefault();
      void send();
    }
  }

  async function send() {
    const content = text.trim();
    if (!content || sending || !userId || !groupId) return;
    setSending(true);
    const { error } = await supabase
      .from("messages")
      .insert({ group_id: groupId, user_id: userId, content });
    setSending(false);
    if (!error) setText("");
  }

  async function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[messages.length - 1].created_at;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const older = await Promise.all(
      ((data ?? []) as Message[]).map(async (m) => ({
        ...m,
        author_name: await nameFor(m.user_id),
      })),
    );
    setMessages((prev) => [...prev, ...older]);
    setHasMore((data?.length ?? 0) >= PAGE);
    setLoadingOlder(false);
  }

  async function invite() {
    if (!groupId || !userId) return;
    const { data, error } = await supabase
      .from("group_invites")
      .insert({ group_id: groupId, created_by: userId })
      .select("token")
      .single();
    if (error || !data) return;
    const link = Linking.createURL(`join/${data.token}`);

    try {
      await Clipboard.setStringAsync(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Kopiering kan nekas av webbläsaren (t.ex. saknad användarinteraktion) - visa länken istället.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.prompt("Kopiera inbjudningslänken:", link);
      }
    }

    if (Platform.OS !== "web") {
      Share.share({
        message: `Gå med i "${group?.name ?? "gruppen"}" på Ladchat:\n\n${link}`,
      }).catch(() => {});
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.backgroundElement }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {group?.name ?? ""}
        </Text>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
        <Pressable onPress={invite} hitSlop={8}>
          <Text style={{ color: c.brand, fontWeight: "700" }}>
            {linkCopied ? "Länk kopierad!" : "Bjud in"}
          </Text>
        </Pressable>
      </View>

      {toast ? (
        <View style={[styles.toast, { backgroundColor: settings.color }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <BeerGlassOrChatBackground
          beerMode={settings.beerMode}
          beerPercent={beerPercent}
          beerRemainingMs={beerRemainingMs}
          image={settings.backgroundImage}
          color={settings.background}
          style={styles.flex}
        >
          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} />
          ) : (
            <FlatList
              data={messages}
              inverted
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.listContent}
              onEndReached={hasMore ? loadOlder : undefined}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                loadingOlder ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null
              }
              ListEmptyComponent={
                <Text style={[styles.empty, { color: c.textSecondary }]}>
                  Inga meddelanden än. Skriv det första!
                </Text>
              }
              renderItem={({ item }) => {
                const mine = item.user_id === userId;
                return (
                  <View style={[styles.msgRow, mine ? styles.mine : styles.theirs]}>
                    {!mine ? (
                      <Text style={[styles.author, { color: c.textSecondary }]}>
                        {item.author_name}
                      </Text>
                    ) : null}
                    <View
                      style={[
                        styles.bubble,
                        mine
                          ? { backgroundColor: settings.color, borderBottomRightRadius: 4 }
                          : {
                              backgroundColor: c.backgroundElement,
                              borderBottomLeftRadius: 4,
                            },
                      ]}
                    >
                      <Text style={{ color: mine ? "#fff" : c.text, fontSize: 15 }}>
                        {item.content}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          <View style={[styles.inputBar, { borderTopColor: c.backgroundElement }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Skriv ett meddelande…"
              placeholderTextColor={c.textSecondary}
              multiline
              onKeyPress={handleKeyPress}
              style={[
                styles.input,
                { color: c.text, borderColor: c.backgroundSelected },
              ]}
            />
            <Pressable
              onPress={send}
              disabled={sending || text.trim().length === 0}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: settings.color,
                  opacity: sending || text.trim().length === 0 ? 0.4 : 1,
                },
              ]}
            >
              <Text style={styles.sendText}>Skicka</Text>
            </Pressable>
          </View>
        </BeerGlassOrChatBackground>
      </KeyboardAvoidingView>

      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSettingsOpen(false)}
        />
        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          <Text style={[styles.sheetTitle, { color: c.text }]}>
            Inställningar för chatten
          </Text>

          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Färg</Text>
          <View style={styles.swatchRow}>
            {COLOR_OPTIONS.map((color) => (
              <Pressable
                key={color}
                onPress={() => updateSettings({ color })}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  settings.color === color ? styles.swatchSelected : null,
                ]}
              />
            ))}
          </View>

          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Bakgrund</Text>
          <View style={styles.swatchRow}>
            {BACKGROUND_OPTIONS.map((bg) => (
              <Pressable
                key={bg.label}
                onPress={() => updateSettings({ background: bg.value, backgroundImage: "" })}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: bg.value || c.backgroundElement,
                    borderWidth: 1,
                    borderColor: c.backgroundSelected,
                  },
                  !settings.backgroundImage && settings.background === bg.value
                    ? styles.swatchSelected
                    : null,
                ]}
              />
            ))}
          </View>

          <View style={styles.bgImageRow}>
            <Pressable
              onPress={pickBackgroundImage}
              style={[styles.bgImageBtn, { borderColor: c.backgroundSelected }]}
            >
              {settings.backgroundImage ? (
                <ImageBackground
                  source={{ uri: settings.backgroundImage }}
                  style={styles.bgImageThumb}
                  imageStyle={{ borderRadius: 10 }}
                />
              ) : (
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>
                  Välj bild från telefonen
                </Text>
              )}
            </Pressable>
            {settings.backgroundImage ? (
              <Pressable onPress={() => updateSettings({ backgroundImage: "" })} hitSlop={8}>
                <Text style={{ color: c.textSecondary, fontSize: 13 }}>Ta bort</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Valuta</Text>
          <View style={styles.swatchRow}>
            {CURRENCY_OPTIONS.map((currency) => (
              <Pressable
                key={currency}
                onPress={() => updateSettings({ currency })}
                style={[
                  styles.chip,
                  { borderColor: c.backgroundSelected },
                  settings.currency === currency
                    ? { backgroundColor: settings.color, borderColor: settings.color }
                    : null,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: settings.currency === currency ? "#fff" : c.text },
                  ]}
                >
                  {currency}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.pointsText, { color: c.textSecondary }]}>
            Du har {settings.currencyPoints} {settings.currency}
          </Text>

          <View style={styles.soundRow}>
            <Text style={[styles.sheetLabel, { color: c.textSecondary, marginBottom: 0 }]}>
              Öl-mode 🍺 (bakgrunden fylls på 1% per meddelande)
            </Text>
            <Switch
              value={settings.beerMode}
              onValueChange={toggleBeerMode}
            />
          </View>

          {settings.beerMode ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
                Tid (nollställer och startar om rundan)
              </Text>
              <View style={styles.swatchRow}>
                {BEER_DURATION_OPTIONS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    onPress={() => selectBeerDuration(minutes)}
                    style={[
                      styles.chip,
                      { borderColor: c.backgroundSelected },
                      settings.beerDurationMinutes === minutes
                        ? { backgroundColor: settings.color, borderColor: settings.color }
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        {
                          color:
                            settings.beerDurationMinutes === minutes ? "#fff" : c.text,
                        },
                      ]}
                    >
                      {minutes} min
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.pointsText, { color: c.textSecondary }]}>
                Belöning: {BEER_DURATION_REWARDS[settings.beerDurationMinutes] ?? 1}{" "}
                {settings.currency} när glaset blir fullt
              </Text>
            </>
          ) : null}

          <View style={styles.soundRow}>
            <Text style={[styles.sheetLabel, { color: c.textSecondary, marginBottom: 0 }]}>
              Ljud vid nya meddelanden
            </Text>
            <Switch
              value={settings.soundEnabled}
              onValueChange={(v) => updateSettings({ soundEnabled: v })}
            />
          </View>

          <Pressable
            onPress={() => setSettingsOpen(false)}
            style={[styles.closeBtn, { backgroundColor: settings.color }]}
          >
            <Text style={styles.sendText}>Klart</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { paddingHorizontal: 4 },
  gear: { paddingHorizontal: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  listContent: { padding: 12, gap: 8 },
  empty: { textAlign: "center", marginTop: 40, transform: [{ scaleY: -1 }] },
  msgRow: { maxWidth: "82%" },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  author: { fontSize: 12, marginBottom: 2, marginLeft: 6 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontWeight: "700" },
  beerBackdrop: { backgroundColor: "#2a1a10" },
  beerGlassWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    opacity: 0.9,
  },
  beerLabel: { color: "#fff", fontWeight: "800", fontSize: 14 },
  beerGlass: {
    width: 140,
    height: 220,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.55)",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  beerLiquidColumn: { width: "100%" },
  beerFoam: { width: "100%", height: 10, backgroundColor: "#fff8e1" },
  beerLiquid: { flex: 1, width: "100%", backgroundColor: "#f2a916" },
  beerCountdownWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  beerCountdownBig: {
    width: "70%",
    textAlign: "center",
    color: "rgba(255,255,255,0.16)",
    fontSize: 140,
    fontWeight: "900",
  },
  toast: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
    zIndex: 20,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  toastText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  pointsText: { fontSize: 12, marginTop: 6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  sheetLabel: { fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 8 },
  swatchRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: "#94a3b8",
  },
  bgImageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 10,
  },
  bgImageBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  bgImageThumb: {
    width: 56,
    height: 40,
  },
  soundRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
  },
  closeBtn: {
    marginTop: 24,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
});
