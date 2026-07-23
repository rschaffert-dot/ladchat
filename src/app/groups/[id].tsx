import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  FlatList,
  Image,
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
  Vibration,
  View,
} from "react-native";
import type {
  NativeSyntheticEvent,
  StyleProp,
  TextInputKeyPressEventData,
  ViewStyle,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { BEER_DURATION_BONUS, BEER_DURATION_OPTIONS, BEER_GLASSES } from "@/lib/beer";
import {
  BACKGROUND_OPTIONS,
  COLOR_OPTIONS,
  CURRENCY_OPTIONS,
  DEFAULT_CHAT_SETTINGS,
  loadChatSettings,
  saveChatSettings,
} from "@/lib/chatSettings";
import type { ChatSettings } from "@/lib/chatSettings";
import {
  ACTIVATION_KINDS,
  formatDuration,
  uploadActivationMedia,
  videoDurationMs,
} from "@/lib/activation";
import { getChatMediaUrl, uploadChatMedia } from "@/lib/chatMedia";
import { levelForPoints, titleForPoints } from "@/lib/gamification";
import GameCenter from "@/components/GameCenter";
import { REACTIONS, REACTION_ORDER } from "@/lib/reactions";
import { supabase } from "@/lib/supabase";
import type {
  ActivationParticipation,
  BeerGlassSize,
  Duel,
  Group,
  GroupActivation,
  Message,
  MessageReaction,
  MessageWithAuthor,
  PowerHour,
  ReactionKey,
  Streak,
} from "@/lib/types";
import { useColors } from "@/lib/ui";
import { useIsAdmin } from "@/lib/useIsAdmin";

type LeaderboardRow = { userId: string; name: string; points: number };

/** Lokala sändningstillstånd för optimistisk UI (finns aldrig i databasen). */
type LocalMsg = MessageWithAuthor & { pending?: boolean; failed?: boolean };

/** Diskret haptik där plattformen stödjer det — tyst annars. */
function buzz(ms = 10) {
  try {
    Vibration.vibrate(ms);
  } catch {
    // Ingen vibrationsmotor — lugnt.
  }
}

/** Messenger-lika bubblande punkter för skriver-indikatorn. */
function TypingDots({ color }: { color: string }) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <View style={{ flexDirection: "row", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <RNAnimated.View
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: color,
            opacity: anim.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: i === 0 ? [1, 0.3, 1] : i === 1 ? [0.3, 1, 0.3] : [0.6, 0.3, 1],
            }),
          }}
        />
      ))}
    </View>
  );
}
type ReactionBucket = Partial<Record<ReactionKey, { count: number; mine: boolean }>>;

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

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Längre nedräkning (aktiveringens svarstid kan vara timmar).
function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return formatCountdown(ms);
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

function BeerGlassBackground({
  size,
  fillCl,
  remainingMs,
  style,
  children,
}: {
  size: BeerGlassSize;
  fillCl: number;
  remainingMs: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const glass = BEER_GLASSES[size];
  const percent = Math.min(100, Math.round((fillCl / glass.capacityCl) * 100));
  return (
    <View style={[style, styles.beerBackdrop]}>
      <View style={styles.beerCountdownWrap} pointerEvents="none">
        <Text style={styles.beerCountdownBig} numberOfLines={1} adjustsFontSizeToFit>
          {formatCountdown(remainingMs)}
        </Text>
      </View>
      <View style={styles.beerGlassWrap} pointerEvents="none">
        <Text style={styles.beerLabel}>
          {glass.label} · {fillCl}/{glass.capacityCl} cl
        </Text>
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

const PAGE = 30;
const MISSING = "00000000-0000-0000-0000-000000000000";

const QUICK_EMOJIS = [
  "😀", "😂", "🤣", "😎", "😭", "😡", "🥴", "🤠",
  "❤️", "🔥", "👍", "👎", "💪", "🍺", "🐐", "💀",
  "🎉", "👀", "🙏", "🤝", "🖕", "💩", "🧠", "⚽",
];

function ChatImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getChatMediaUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  const [fullscreen, setFullscreen] = useState(false);
  if (!url) return <ActivityIndicator style={{ margin: 24 }} />;
  return (
    <>
      <Pressable onPress={() => setFullscreen(true)}>
        <Image source={{ uri: url }} style={styles.chatImage} resizeMode="cover" />
      </Pressable>
      <Modal
        visible={fullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(false)}
      >
        <Pressable style={styles.lightbox} onPress={() => setFullscreen(false)}>
          <Image source={{ uri: url }} style={styles.lightboxImage} resizeMode="contain" />
          <Pressable
            onPress={() => setFullscreen(false)}
            hitSlop={16}
            style={styles.lightboxClose}
          >
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>×</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const AUDIO_SPEEDS = [1, 1.5, 2] as const;

function AudioBubble({
  path,
  durationMs,
  tint,
}: {
  path: string;
  durationMs: number | null;
  tint: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pseudovågform: deterministiska staplar ur sökvägen (ingen ljudanalys
  // behövs för känslan — mönstret är stabilt per memo).
  const bars = (() => {
    let h = 0;
    for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
    return Array.from({ length: 24 }, (_, i) => 5 + Math.abs(Math.sin(h + i * 7.3)) * 13);
  })();

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  async function toggle() {
    // Uppspelning via webbens Audio-API — på native visas bara etiketten tills vidare.
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      const url = await getChatMediaUrl(path);
      if (!url) return;
      const audio = new window.Audio(url);
      audio.onended = () => {
        setPlaying(false);
        setPositionMs(0);
      };
      audio.ontimeupdate = () => setPositionMs(audio.currentTime * 1000);
      audioRef.current = audio;
    }
    audioRef.current.playbackRate = AUDIO_SPEEDS[speedIdx];
    void audioRef.current.play();
    setPlaying(true);
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % AUDIO_SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = AUDIO_SPEEDS[next];
  }

  const progress = durationMs ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View style={styles.audioBubble}>
      <Pressable onPress={toggle} hitSlop={8}>
        <Text style={{ color: tint, fontSize: 20 }}>{playing ? "⏸" : "▶️"}</Text>
      </Pressable>
      <View style={styles.waveform}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={{
              width: 3,
              height: h,
              borderRadius: 2,
              backgroundColor: tint,
              opacity: i / bars.length <= progress ? 1 : 0.35,
            }}
          />
        ))}
      </View>
      <Text style={{ color: tint, fontSize: 11, fontWeight: "700", minWidth: 34 }}>
        {playing || positionMs > 0
          ? formatCountdown(positionMs)
          : durationMs
            ? formatCountdown(durationMs)
            : "🎤"}
      </Text>
      <Pressable onPress={cycleSpeed} hitSlop={8} style={styles.speedChip}>
        <Text style={{ color: tint, fontSize: 11, fontWeight: "800" }}>
          {AUDIO_SPEEDS[speedIdx]}x
        </Text>
      </Pressable>
    </View>
  );
}

/** Gör URL:er i meddelandetext klickbara. */
const URL_RE = /(https?:\/\/[^\s]+)/g;
function LinkifiedText({
  content,
  color,
  linkColor,
  suffix,
}: {
  content: string;
  color: string;
  linkColor: string;
  suffix?: ReactNode;
}) {
  const parts = content.split(URL_RE);
  return (
    <Text style={{ color, fontSize: 15, lineHeight: 21 }}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={i}
            style={{ color: linkColor, textDecorationLine: "underline" }}
            onPress={() => void Linking.openURL(part)}
          >
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
      {suffix}
    </Text>
  );
}

type PollView = {
  question: string;
  options: { id: string; label: string; votes: number }[];
  total: number;
  mine: string | null;
};

type RowActions = {
  openMenu: (m: LocalMsg) => void;
  tap: (m: LocalMsg, mine: boolean) => void;
  reply: (m: LocalMsg) => void;
  toggleReaction: (id: string, key: ReactionKey) => void;
  votePoll: (pid: string, oid: string) => void;
  retry: (m: LocalMsg) => void;
  removeLocal: (id: string) => void;
  openChallenge: (cid: string) => void;
};

/** En meddelanderad, memoiserad: sekundtick, tangenttryck och andra
 *  skärmuppdateringar rör inte raderna om deras egna props är oförändrade —
 *  det är det som håller svep/gester/modaler mjuka i långa chattar. */
const ChatMessageRow = memo(function ChatMessageRow({
  item,
  mine,
  authorName,
  authorTitle,
  parentAuthor,
  parentContent,
  bubbleColor,
  c,
  bucket,
  isLatestOwn,
  readUpTo,
  poll,
  highlighted,
  act,
}: {
  item: LocalMsg;
  mine: boolean;
  authorName: string | null;
  authorTitle: string | null;
  parentAuthor: string | null;
  parentContent: string | null;
  bubbleColor: string;
  c: ReturnType<typeof useColors>;
  bucket: ReactionBucket | undefined;
  isLatestOwn: boolean;
  readUpTo: string | null;
  poll: PollView | null;
  highlighted?: boolean;
  act: RowActions;
}) {
  if (item.kind === "system") {
    const challengeId = item.metadata?.challenge_id as string | undefined;
    return (
      <Pressable
        onPress={() => challengeId && act.openChallenge(challengeId)}
        style={[styles.systemPill, { backgroundColor: c.backgroundElement }]}
      >
        <Text style={{ color: c.brand, fontWeight: "700", fontSize: 13 }}>
          {item.content} {challengeId ? "→" : ""}
        </Text>
      </Pressable>
    );
  }

  let swipeRef: Swipeable | null = null;
  return (
    <Swipeable
      ref={(r) => {
        swipeRef = r;
      }}
      friction={2}
      leftThreshold={48}
      overshootLeft={false}
      renderLeftActions={() => (
        <View style={styles.swipeReply}>
          <Text style={{ fontSize: 20, color: c.textSecondary }}>↩︎</Text>
        </View>
      )}
      onSwipeableWillOpen={(direction) => {
        if (direction === "left" && !item.pending) {
          buzz(8);
          act.reply(item);
        }
        swipeRef?.close();
      }}
    >
      <View style={[styles.msgRow, mine ? styles.mine : styles.theirs]}>
        {authorName ? (
          <Text style={[styles.author, { color: c.textSecondary }]}>
            {authorName} · <Text style={{ fontWeight: "700" }}>{authorTitle}</Text>
          </Text>
        ) : null}
        <Pressable
          onLongPress={() => act.openMenu(item)}
          delayLongPress={350}
          onPress={() => act.tap(item, mine)}
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: bubbleColor, borderBottomRightRadius: 4 }
              : { backgroundColor: c.backgroundElement, borderBottomLeftRadius: 4 },
            item.pending ? { opacity: 0.55 } : null,
            highlighted ? { borderWidth: 2, borderColor: "#f2a916" } : null,
          ]}
        >
          {item.reply_to_id ? (
            <View style={styles.quoteBox}>
              <Text style={styles.quoteAuthor} numberOfLines={1}>
                {parentAuthor ?? "Svar"}
              </Text>
              <Text style={styles.quoteContent} numberOfLines={2}>
                {parentContent ?? "…"}
              </Text>
            </View>
          ) : null}
          {item.kind === "image" && item.metadata?.media_path ? (
            <ChatImage path={item.metadata.media_path as string} />
          ) : item.kind === "audio" && item.metadata?.media_path ? (
            <AudioBubble
              path={item.metadata.media_path as string}
              durationMs={(item.metadata.duration_ms as number) ?? null}
              tint={mine ? "#fff" : c.text}
            />
          ) : item.kind === "poll" && item.metadata?.poll_id ? (
            !poll ? (
              <ActivityIndicator style={{ margin: 12 }} />
            ) : (
              <View style={styles.pollBox}>
                <Text
                  style={{
                    color: mine ? "#fff" : c.text,
                    fontWeight: "800",
                    fontSize: 15,
                    marginBottom: 6,
                  }}
                >
                  📊 {poll.question}
                </Text>
                {poll.options.map((o) => {
                  const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
                  const isMine = poll.mine === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => act.votePoll(item.metadata.poll_id as string, o.id)}
                      style={[styles.pollOption, isMine ? styles.pollOptionMine : null]}
                    >
                      <View style={[styles.pollFill, { width: `${pct}%` }]} />
                      <View style={styles.pollOptionRow}>
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: isMine ? "800" : "600",
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {isMine ? "✓ " : ""}
                          {o.label}
                        </Text>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                          {o.votes} ({pct}%)
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Text style={{ color: mine ? "#e0e0ff" : c.textSecondary, fontSize: 11 }}>
                  {poll.total} {poll.total === 1 ? "röst" : "röster"} — tryck för att rösta
                </Text>
              </View>
            )
          ) : (
            <>
              {item.metadata?.forwarded ? (
                <Text
                  style={{
                    color: mine ? "#e0e0ff" : c.textSecondary,
                    fontSize: 11,
                    fontStyle: "italic",
                  }}
                >
                  ↪️ Vidarebefordrat
                </Text>
              ) : null}
              <LinkifiedText
                content={item.content}
                color={mine ? "#fff" : c.text}
                linkColor={mine ? "#bfdbfe" : c.brand}
                suffix={
                  item.edited_at ? (
                    <Text style={{ color: mine ? "#e0e0ff" : c.textSecondary, fontSize: 11 }}>
                      {"  (redigerad)"}
                    </Text>
                  ) : null
                }
              />
            </>
          )}
        </Pressable>
        {mine && isLatestOwn && !item.pending && !item.failed ? (
          <Text
            style={[
              styles.msgStatus,
              {
                color:
                  readUpTo && item.created_at <= readUpTo ? "#3b82f6" : c.textSecondary,
              },
            ]}
          >
            {readUpTo && item.created_at <= readUpTo ? "✓✓ Läst" : "✓ Skickat"}
          </Text>
        ) : null}
        {item.pending ? (
          <Text style={[styles.msgStatus, { color: c.textSecondary }]}>🕒 Skickar…</Text>
        ) : null}
        {item.failed ? (
          <View style={styles.failedRow}>
            <Text style={{ color: "#dc2626", fontSize: 12, fontWeight: "700" }}>
              ⚠️ Kunde inte skickas
            </Text>
            <Pressable onPress={() => act.retry(item)} hitSlop={8}>
              <Text style={{ color: c.brand, fontSize: 12, fontWeight: "700" }}>Försök igen</Text>
            </Pressable>
            <Pressable onPress={() => act.removeLocal(item.id)} hitSlop={8}>
              <Text style={{ color: c.textSecondary, fontSize: 12 }}>Ta bort</Text>
            </Pressable>
          </View>
        ) : null}
        {(() => {
          const active = REACTION_ORDER.filter((key) => (bucket?.[key]?.count ?? 0) > 0);
          if (active.length === 0) return null;
          return (
            <View style={styles.reactionRow}>
              {active.map((key) => {
                const entry = bucket?.[key];
                return (
                  <Pressable
                    key={key}
                    onPress={() => !mine && act.toggleReaction(item.id, key)}
                    style={[
                      styles.reactionChip,
                      { backgroundColor: c.backgroundElement },
                      entry?.mine
                        ? { backgroundColor: bubbleColor, borderColor: bubbleColor }
                        : null,
                    ]}
                  >
                    <Text style={{ fontSize: 13 }}>
                      {REACTIONS[key].emoji} {entry?.count ?? 0}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })()}
      </View>
    </Swipeable>
  );
});

export default function GroupChatScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const isAdmin = useIsAdmin();
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
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionBucket>>({});
  const [celebration, setCelebration] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [activation, setActivation] = useState<GroupActivation | null>(null);
  const [participations, setParticipations] = useState<ActivationParticipation[]>([]);
  const [activationBusy, setActivationBusy] = useState(false);
  const [memberPoints, setMemberPoints] = useState<Record<string, number>>({});
  const [replyTo, setReplyTo] = useState<MessageWithAuthor | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [quest, setQuest] = useState<{ quest_id: number; title: string; bonus: number } | null>(null);
  const [questDone, setQuestDone] = useState(false);

  // Utkast per chatt: texten överlever chattbyten och omstarter.
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (!groupId) return;
    draftLoadedRef.current = false;
    AsyncStorage.getItem(`draft:${groupId}`).then((v) => {
      if (v) setText(v);
      draftLoadedRef.current = true;
    });
  }, [groupId]);
  useEffect(() => {
    if (!groupId || !draftLoadedRef.current) return;
    const t = setTimeout(() => {
      void AsyncStorage.setItem(`draft:${groupId}`, text);
    }, 400);
    return () => clearTimeout(t);
  }, [text, groupId]);

  // Närvaro: vilka gruppmedlemmar har chatten öppen just nu.
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  useEffect(() => {
    if (!groupId || !userId) return;
    const ch = supabase.channel(`presence:${groupId}`, {
      config: { presence: { key: userId } },
    });
    ch.on("presence", { event: "sync" }, () => {
      setOnlineIds(Object.keys(ch.presenceState()));
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") void ch.track({ at: Date.now() });
    });
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [groupId, userId]);
  const onlineOthers = onlineIds.filter((id) => id !== userId).length;

  // Hoppa-till-botten: syns när man skrollat upp, räknar nya under tiden.
  const listRef = useRef<FlatList | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const awayRef = useRef(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  function jumpToBottom() {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewWhileAway(0);
  }

  // Sök i chatten: träffar markeras och kan bläddras med ↑/↓.
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const chatQuery = chatSearch.trim().toLowerCase();
  const matchIndices = chatQuery
    ? messages.reduce<number[]>((acc, m, i) => {
        if (m.kind !== "system" && m.content.toLowerCase().includes(chatQuery)) acc.push(i);
        return acc;
      }, [])
    : [];
  const currentMatchId =
    matchIndices.length > 0 ? messages[matchIndices[matchIdx % matchIndices.length]]?.id : null;
  function gotoMatch(step: number) {
    if (matchIndices.length === 0) return;
    const next = (matchIdx + step + matchIndices.length) % matchIndices.length;
    setMatchIdx(next);
    listRef.current?.scrollToIndex({ index: matchIndices[next], viewPosition: 0.5 });
  }
  function closeChatSearch() {
    setChatSearchOpen(false);
    setChatSearch("");
    setMatchIdx(0);
  }

  // Klistra in / släpp bilder direkt i chatten (webb).
  const sendMediaRef = useRef<typeof sendMediaMessage | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const grab = (dt: DataTransfer | null): File | null => {
      const f = Array.from(dt?.files ?? [])[0];
      return f && f.type.startsWith("image/") ? f : null;
    };
    const onPaste = (e: ClipboardEvent) => {
      const f = grab(e.clipboardData);
      if (f) {
        e.preventDefault();
        void sendMediaRef.current?.("image", f, f.type, "📷 Bild");
      }
    };
    const onDrop = (e: DragEvent) => {
      const f = grab(e.dataTransfer);
      if (f) {
        e.preventDefault();
        void sendMediaRef.current?.("image", f, f.type, "📷 Bild");
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, []);

  // Växande textfält: följer innehållet upp till ett tak, sedan skroll.
  const [inputHeight, setInputHeight] = useState(0);

  // Skriver-indikator via broadcast: throttlad sändning, 3s självdöende.
  const [typingName, setTypingName] = useState<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingExpireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingLastSentRef = useRef(0);
  useEffect(() => {
    if (!groupId || !userId) return;
    const channel = supabase
      .channel(`typing:${groupId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { user_id?: string; name?: string };
        if (!p.user_id || p.user_id === userId) return;
        setTypingName(p.name ?? "Någon");
        if (typingExpireRef.current) clearTimeout(typingExpireRef.current);
        typingExpireRef.current = setTimeout(() => setTypingName(null), 3000);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      typingChannelRef.current = null;
      if (typingExpireRef.current) clearTimeout(typingExpireRef.current);
      void supabase.removeChannel(channel);
    };
  }, [groupId, userId]);
  function onTypeText(t: string) {
    setText(t);
    const now = Date.now();
    if (t.length > 0 && userId && now - typingLastSentRef.current > 1500) {
      typingLastSentRef.current = now;
      void typingChannelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: userId, name: namesRef.current[userId] ?? "Någon" },
      });
    }
  }

  // Läskvitton: ✓ = skickat, blå ✓✓ = alla andra medlemmar har läst.
  const [reads, setReads] = useState<Record<string, string>>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  useEffect(() => {
    if (!groupId || !userId) return;
    void supabase.rpc("mark_read", { gid: groupId });
    void supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .then(({ data }) => setMemberIds((data ?? []).map((m) => m.user_id as string)));
    void supabase
      .from("message_reads")
      .select("user_id, last_read_at")
      .eq("group_id", groupId)
      .then(({ data }) =>
        setReads(
          Object.fromEntries(
            (data ?? []).map((r) => [r.user_id as string, r.last_read_at as string]),
          ),
        ),
      );
    const channel = supabase
      .channel(`reads:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const r = payload.new as { user_id?: string; last_read_at?: string };
          if (r?.user_id && r.last_read_at) {
            setReads((prev) => ({ ...prev, [r.user_id!]: r.last_read_at! }));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, userId]);
  // Alla andra läst fram till denna tidpunkt (null = någon saknas/efter).
  const othersReadUpTo = (() => {
    const others = memberIds.filter((id) => id !== userId);
    if (others.length === 0) return null;
    let min: string | null = null;
    for (const id of others) {
      const at = reads[id];
      if (!at) return null;
      if (min === null || at < min) min = at;
    }
    return min;
  })();

  // Redigering & vidarebefordran.
  const [editingMsg, setEditingMsg] = useState<LocalMsg | null>(null);
  const [forwardMsg, setForwardMsg] = useState<LocalMsg | null>(null);
  const [forwardGroups, setForwardGroups] = useState<{ id: string; name: string }[]>([]);
  function startEdit(msg: LocalMsg) {
    setEditingMsg(msg);
    setReplyTo(null);
    setText(msg.content);
  }
  function cancelEdit() {
    setEditingMsg(null);
    setText("");
  }
  async function saveEdit() {
    if (!editingMsg) return;
    const content = text.trim();
    if (!content) return;
    const mid = editingMsg.id;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === mid ? { ...m, content, edited_at: new Date().toISOString() } : m,
      ),
    );
    setEditingMsg(null);
    setText("");
    await supabase.rpc("edit_message", { mid, new_content: content });
  }
  async function openForward(msg: LocalMsg) {
    setForwardMsg(msg);
    if (!userId) return;
    const { data } = await supabase
      .from("groups")
      .select("id,name,group_members!inner(user_id)")
      .eq("group_members.user_id", userId);
    setForwardGroups(
      ((data ?? []) as { id: string; name: string }[])
        .map((g) => ({ id: g.id, name: g.name }))
        .filter((g) => g.id !== groupId),
    );
  }
  async function forwardTo(gid: string) {
    if (!forwardMsg || !userId) return;
    await supabase.from("messages").insert({
      group_id: gid,
      user_id: userId,
      content: forwardMsg.content,
      metadata: { forwarded: true },
    });
    setForwardMsg(null);
  }

  // Långtrycksmeny på meddelanden (reaktioner + åtgärder).
  const [menuMsg, setMenuMsg] = useState<LocalMsg | null>(null);
  const lastTapRef = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  async function copyMessage(msg: LocalMsg) {
    await Clipboard.setStringAsync(msg.content);
  }
  async function deleteMessage(msg: LocalMsg) {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    await supabase.from("messages").delete().eq("id", msg.id);
  }
  /** Dubbeltryck = snabbreaktion (💪), enkeltryck lämnas till innehållet. */
  function onBubbleTap(item: LocalMsg, mine: boolean) {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.at < 300 && !mine) {
      buzz(8);
      void toggleReaction(item.id, REACTION_ORDER[0]);
    }
    lastTapRef.current = { id: item.id, at: now };
  }

  // Messenger-lik header/komposer: olästa i andra chattar, ✦-startmeny,
  // samtalsknappar (samtal är inte byggt än — knapparna berättar det).
  const [unreadOther, setUnreadOther] = useState(0);
  const [starOpen, setStarOpen] = useState(false);
  const [callNote, setCallNote] = useState<string | null>(null);
  const callNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function noteCall(video: boolean) {
    if (callNoteTimer.current) clearTimeout(callNoteTimer.current);
    setCallNote(video ? "🎥 Videosamtal kommer i en senare fas!" : "📞 Gruppsamtal kommer i en senare fas!");
    callNoteTimer.current = setTimeout(() => setCallNote(null), 2500);
  }
  useEffect(() => {
    if (!groupId || !userId) return;
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false)
      .neq("group_id", groupId)
      .then(({ count }) => setUnreadOther(count ?? 0));
  }, [groupId, userId]);

  // Stängda bannrar ("notisen är läst"): per grupp och enhet. Nycklarna
  // innehåller id/datum så en NY duell/aktivering/uppdrag syns igen.
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!groupId) return;
    AsyncStorage.getItem(`dismissedBanners:${groupId}`).then((raw) => {
      if (raw) {
        try {
          setDismissed(JSON.parse(raw) as Record<string, true>);
        } catch {
          // Trasig cache — börja om tom.
        }
      }
    });
  }, [groupId]);
  function dismissBanner(key: string) {
    setDismissed((prev) => {
      const next: Record<string, true> = { ...prev, [key]: true };
      // Håll listan kort: äldsta ryker när det blir fler än 50.
      const keys = Object.keys(next);
      if (keys.length > 50) delete next[keys[0]];
      void AsyncStorage.setItem(`dismissedBanners:${groupId}`, JSON.stringify(next));
      return next;
    });
  }
  const [duel, setDuel] = useState<Duel | null>(null);
  const [duelVotes, setDuelVotes] = useState<{ ch: number; op: number; mine: string | null }>({
    ch: 0,
    op: 0,
    mine: null,
  });
  const [duelModalOpen, setDuelModalOpen] = useState(false);
  const [duelStake, setDuelStake] = useState("10");
  const [duelOpponent, setDuelOpponent] = useState<string | null>(null);
  const [powerHourEndsAt, setPowerHourEndsAt] = useState<number | null>(null);
  const [weekly, setWeekly] = useState<LeaderboardRow[]>([]);
  const [teamScore, setTeamScore] = useState<{
    member: number;
    team: number;
    total: number;
  } | null>(null);
  const [gotw, setGotw] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", "", "", ""]);
  const [polls, setPolls] = useState<
    Record<
      string,
      {
        question: string;
        options: { id: string; label: string; votes: number }[];
        total: number;
        mine: string | null;
      }
    >
  >({});
  // Spelcentret (lobby + alla spel) bor i src/components/GameCenter.tsx.
  const [gameOpen, setGameOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRecordingRef = useRef(false);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const namesRef = useRef<Record<string, string>>({});
  const prevOwnPointsRef = useRef<number | null>(null);
  const settledDuelRef = useRef<string | null>(null);
  // DELETE-events för RLS-skyddade tabeller innehåller bara primärnyckeln
  // (id) från Supabase Realtime, inte hela raden — trots replica identity
  // full. Vi sparar radernas innehåll själva för att kunna slå upp vad
  // som togs bort.
  const reactionRowsRef = useRef<Record<string, MessageReaction>>({});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activationRef = useRef<GroupActivation | null>(activation);
  activationRef.current = activation;

  const myParticipation = participations.find((p) => p.user_id === userId) ?? null;
  const activationRemainingMs = activation
    ? Math.max(0, new Date(activation.deadline_at).getTime() - nowTick)
    : 0;

  const beerRemainingMs =
    group?.beer_round_started_at && group.beer_duration_minutes
      ? Math.max(
          0,
          new Date(group.beer_round_started_at).getTime() +
            group.beer_duration_minutes * 60_000 -
            nowTick,
        )
      : 0;

  // Energin förfaller med 1 per 2:e tyst minut — beräknas klient-side ur
  // senaste server-värdet så baren sjunker live utan extra anrop.
  const energyNow = group
    ? Math.max(
        0,
        group.energy -
          Math.floor((nowTick - new Date(group.energy_updated_at).getTime()) / 120_000),
      )
    : 0;

  const powerHourRemainingMs = powerHourEndsAt ? Math.max(0, powerHourEndsAt - nowTick) : 0;
  const powerHourActive = powerHourRemainingMs > 0;

  const duelRemainingMs =
    duel?.status === "active" && duel.ends_at
      ? Math.max(0, new Date(duel.ends_at).getTime() - nowTick)
      : 0;

  // Klockan driver nedräkningarna — men en sekundtick re-renderar hela
  // skärmen, vilket hackar sönder gester och modalanimationer. Därför
  // tickar vi bara varje sekund när en nedräkning faktiskt syns; annars
  // räcker varje minut (energibarens upplösning är 2 min).
  const needsFastTick =
    Boolean(activation) ||
    Boolean(group?.beer_round_started_at && group?.beer_duration_minutes) ||
    powerHourActive ||
    duel?.status === "active";
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), needsFastTick ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [needsFastTick]);

  const loadActivation = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from("group_activations")
      .select("*")
      .eq("group_id", groupId)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const act = (data as GroupActivation) ?? null;
    setActivation(act);
    if (act) {
      const { data: parts } = await supabase
        .from("activation_participations")
        .select("*")
        .eq("activation_id", act.id);
      setParticipations((parts ?? []) as ActivationParticipation[]);
    } else {
      setParticipations([]);
    }
  }, [groupId]);

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

  const loadReactionsFor = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { data } = await supabase
        .from("message_reactions")
        .select("id, message_id, user_id, reaction")
        .in("message_id", ids);
      if (!data) return;
      for (const row of data as MessageReaction[]) {
        reactionRowsRef.current[row.id] = row;
      }
      setReactions((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = {};
        for (const row of data as Pick<MessageReaction, "message_id" | "user_id" | "reaction">[]) {
          const bucket = { ...(next[row.message_id] ?? {}) };
          const entry = bucket[row.reaction] ?? { count: 0, mine: false };
          bucket[row.reaction] = {
            count: entry.count + 1,
            mine: entry.mine || row.user_id === userId,
          };
          next[row.message_id] = bucket;
        }
        return next;
      });
    },
    [userId],
  );

  const loadPolls = useCallback(
    async (pollIds: string[]) => {
      if (!pollIds.length) return;
      const [{ data: ps }, { data: opts }, { data: votes }] = await Promise.all([
        supabase.from("polls").select("id, question").in("id", pollIds),
        supabase.from("poll_options").select("id, poll_id, label, idx").in("poll_id", pollIds).order("idx"),
        supabase.from("poll_votes").select("poll_id, option_id, voter_id").in("poll_id", pollIds),
      ]);
      setPolls((prev) => {
        const next = { ...prev };
        for (const p of ps ?? []) {
          const pOpts = (opts ?? []).filter((o) => o.poll_id === p.id);
          const pVotes = (votes ?? []).filter((v) => v.poll_id === p.id);
          next[p.id as string] = {
            question: p.question as string,
            options: pOpts.map((o) => ({
              id: o.id as string,
              label: o.label as string,
              votes: pVotes.filter((v) => v.option_id === o.id).length,
            })),
            total: pVotes.length,
            mine: (pVotes.find((v) => v.voter_id === userId)?.option_id as string) ?? null,
          };
        }
        return next;
      });
    },
    [userId],
  );

  const pollIdsIn = (list: Message[]) =>
    list
      .filter((m) => m.kind === "poll")
      .map((m) => m.metadata?.poll_id as string)
      .filter(Boolean);

  const loadLeaderboard = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from("group_members")
      .select("user_id, points")
      .eq("group_id", groupId)
      .order("points", { ascending: false });
    const rows = await Promise.all(
      (data ?? []).map(async (r) => ({
        userId: r.user_id as string,
        points: r.points as number,
        name: await nameFor(r.user_id as string),
      })),
    );
    setLeaderboard(rows);
    setMemberPoints(Object.fromEntries(rows.map((r) => [r.userId, r.points])));
  }, [groupId, nameFor]);

  const loadDuel = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from("duels")
      .select("*")
      .eq("group_id", groupId)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = (data as Duel) ?? null;
    setDuel(d);
    if (d) {
      const { data: votes } = await supabase
        .from("duel_votes")
        .select("voter_id, voted_for")
        .eq("duel_id", d.id);
      const list = votes ?? [];
      setDuelVotes({
        ch: list.filter((v) => v.voted_for === d.challenger_id).length,
        op: list.filter((v) => v.voted_for === d.opponent_id).length,
        mine: list.find((v) => v.voter_id === userId)?.voted_for ?? null,
      });
    } else {
      setDuelVotes({ ch: 0, op: 0, mine: null });
    }
  }, [groupId, userId]);

  const loadGamification = useCallback(async () => {
    if (!groupId || !userId) return;
    const [{ data: st }, { data: q }, { data: ph }] = await Promise.all([
      supabase
        .from("streaks")
        .select("*")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.rpc("todays_quest"),
      supabase
        .from("power_hours")
        .select("*")
        .eq("group_id", groupId)
        .gt("ends_at", new Date().toISOString())
        .order("ends_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setStreak((st as Streak) ?? null);
    const qRow = Array.isArray(q) ? q[0] : q;
    setQuest((qRow as { quest_id: number; title: string; bonus: number }) ?? null);
    setPowerHourEndsAt(ph ? new Date((ph as PowerHour).ends_at).getTime() : null);

    const today = new Date().toISOString().slice(0, 10);
    const { data: qc } = await supabase
      .from("quest_completions")
      .select("quest_date")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("quest_date", today)
      .maybeSingle();
    setQuestDone(Boolean(qc));

    // Markera gruppens notiser som lästa när chatten öppnas.
    void supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("group_id", groupId)
      .eq("read", false);
  }, [groupId, userId]);

  // Initial laddning.
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    (async () => {
      const { data: g } = await supabase
        .from("groups")
        .select(
          "id,name,owner_id,created_at,beer_glass_size,beer_fill_cl,beer_round_started_at,beer_duration_minutes,energy,energy_updated_at",
        )
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
      void loadReactionsFor(list.map((m) => m.id));
      void loadPolls(pollIdsIn(list));
      void loadActivation();
      void loadLeaderboard();
      void loadDuel();
      void loadGamification();
    })();
    return () => {
      active = false;
    };
  }, [groupId, router, loadReactionsFor, loadPolls, loadActivation, loadLeaderboard, loadDuel, loadGamification]);

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

  // Poängtavlan + veckotopplistan behöver bara vara färska när inställningsrutan visas.
  useEffect(() => {
    if (!settingsOpen || !groupId) return;
    void loadLeaderboard();
    void (async () => {
      const [{ data: wk }, { data: winner }, { data: score }] = await Promise.all([
        supabase.rpc("weekly_leaderboard", { gid: groupId }),
        supabase.rpc("grabb_of_the_week", { gid: groupId }),
        supabase
          .from("group_scores")
          .select("member_points, team_points, total_points")
          .eq("group_id", groupId)
          .maybeSingle(),
      ]);
      setTeamScore(
        score
          ? {
              member: score.member_points as number,
              team: score.team_points as number,
              total: score.total_points as number,
            }
          : null,
      );
      const rows = await Promise.all(
        ((wk ?? []) as { user_id: string; weekly_points: number }[]).map(async (r) => ({
          userId: r.user_id,
          points: Number(r.weekly_points),
          name: await nameFor(r.user_id),
        })),
      );
      setWeekly(rows);
      setGotw((winner as string) ?? null);
    })();
  }, [settingsOpen, groupId, loadLeaderboard, nameFor]);

  async function updateSettings(patch: Partial<ChatSettings>) {
    if (!groupId) return;
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    await saveChatSettings(groupId, next);
  }

  async function setBeerGlass(size: BeerGlassSize | null, durationMinutes: number) {
    if (!groupId) return;
    const { error } = await supabase.rpc("set_beer_glass", {
      gid: groupId,
      size,
      duration_minutes: size ? durationMinutes : null,
    });
    if (error) return;
    setGroup((prev) =>
      prev
        ? {
            ...prev,
            beer_glass_size: size,
            beer_fill_cl: 0,
            beer_round_started_at: size ? new Date().toISOString() : null,
            beer_duration_minutes: size ? durationMinutes : null,
          }
        : prev,
    );
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

  // Realtime: nya meddelanden.
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
          // Motparten skickade — då skriver personen inte längre, och vi
          // läser ju detta nu: uppdatera läskvittot direkt.
          if (m.user_id !== userId) {
            setTypingName(null);
            void supabase.rpc("mark_read", { gid: groupId });
            if (awayRef.current) setNewWhileAway((n) => n + 1);
          }
          if (m.kind === "poll" && m.metadata?.poll_id) {
            void loadPolls([m.metadata.poll_id as string]);
          }
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
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setMessages((prev) => prev.filter((m) => m.id !== oldId));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) =>
            prev.map((x) =>
              x.id === m.id
                ? { ...x, content: m.content, metadata: m.metadata, edited_at: m.edited_at }
                : x,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, nameFor, userId, loadPolls]);

  // Realtime: omröstningsröster.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`polls:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const pid =
            ((payload.new as { poll_id?: string })?.poll_id ??
              (payload.old as { poll_id?: string })?.poll_id) as string | undefined;
          if (pid) void loadPolls([pid]);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, loadPolls]);

  // Realtime: reaktioner. Ingen optimistisk uppdatering (som send()) — vi väntar
  // på DB-eventet, annars dubbelräknas den egna reaktionen.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`reactions:${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const r = payload.new as MessageReaction;
          reactionRowsRef.current[r.id] = r;
          setReactions((prev) => {
            const bucket = { ...(prev[r.message_id] ?? {}) };
            const entry = bucket[r.reaction] ?? { count: 0, mine: false };
            bucket[r.reaction] = {
              count: entry.count + 1,
              mine: entry.mine || r.user_id === userId,
            };
            return { ...prev, [r.message_id]: bucket };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const deletedId = (payload.old as Partial<MessageReaction>).id;
          if (!deletedId) return;
          const r = reactionRowsRef.current[deletedId];
          delete reactionRowsRef.current[deletedId];
          if (!r) return;
          setReactions((prev) => {
            const bucket = { ...(prev[r.message_id] ?? {}) };
            const entry = bucket[r.reaction];
            if (!entry) return prev;
            bucket[r.reaction] = {
              count: Math.max(0, entry.count - 1),
              mine: r.user_id === userId ? false : entry.mine,
            };
            return { ...prev, [r.message_id]: bucket };
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, userId]);

  async function toggleReaction(messageId: string, reaction: ReactionKey) {
    await supabase.rpc("toggle_reaction", { mid: messageId, reaction_key: reaction });
  }

  // Realtime: medlemmarnas poäng (titlar bredvid namn + level-up-firande).
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`points:${groupId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as { user_id: string; points: number };
          setMemberPoints((prev) => ({ ...prev, [row.user_id]: row.points }));
          if (row.user_id === userId) {
            const prevPts = prevOwnPointsRef.current;
            prevOwnPointsRef.current = row.points;
            if (prevPts !== null && levelForPoints(row.points) > levelForPoints(prevPts)) {
              setCelebration(`🎖️ LEVEL UP! Du är nu ${titleForPoints(row.points)}!`);
              setTimeout(() => setCelebration(null), 4000);
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, userId]);

  // Startvärde för level-up-jämförelsen.
  useEffect(() => {
    if (userId && memberPoints[userId] !== undefined && prevOwnPointsRef.current === null) {
      prevOwnPointsRef.current = memberPoints[userId];
    }
  }, [memberPoints, userId]);

  // Realtime: dueller och röster.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`duels:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "duels", filter: `group_id=eq.${groupId}` },
        () => void loadDuel(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "duel_votes", filter: `group_id=eq.${groupId}` },
        () => void loadDuel(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, loadDuel]);

  // Realtime: Power Hour startar.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`powerhours:${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "power_hours", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const ph = payload.new as PowerHour;
          setPowerHourEndsAt(new Date(ph.ends_at).getTime());
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  // Duellen avgörs automatiskt när rösttiden gått ut (första klient som ser det).
  useEffect(() => {
    if (
      duel?.status === "active" &&
      duel.ends_at &&
      duelRemainingMs === 0 &&
      settledDuelRef.current !== duel.id
    ) {
      settledDuelRef.current = duel.id;
      void supabase.rpc("settle_duel", { did: duel.id });
    }
  }, [duel, duelRemainingMs]);

  async function checkin() {
    if (!groupId) return;
    const { data, error } = await supabase.rpc("checkin_streak", { gid: groupId });
    if (error) return;
    const today = new Date().toISOString().slice(0, 10);
    setStreak((prev) => ({
      group_id: groupId,
      user_id: userId ?? "",
      current_streak: (data as number) ?? 1,
      longest_streak: Math.max(prev?.longest_streak ?? 0, (data as number) ?? 1),
      last_checkin: today,
    }));
  }

  async function completeQuest() {
    if (!groupId || questDone) return;
    const { error } = await supabase.rpc("complete_daily_quest", { gid: groupId });
    if (!error) setQuestDone(true);
  }

  async function createDuel() {
    if (!groupId || !duelOpponent) return;
    const stake = parseInt(duelStake, 10);
    if (!Number.isFinite(stake) || stake <= 0) return;
    const { error } = await supabase.rpc("create_duel", {
      gid: groupId,
      opponent: duelOpponent,
      stake_amount: stake,
    });
    if (!error) {
      setDuelModalOpen(false);
      setDuelOpponent(null);
      void loadDuel();
    }
  }

  async function respondDuel(accept: boolean) {
    if (!duel) return;
    await supabase.rpc("respond_duel", { did: duel.id, accept });
    void loadDuel();
  }

  async function cancelDuel() {
    if (!duel) return;
    await supabase.rpc("cancel_duel", { did: duel.id });
    void loadDuel();
  }

  async function voteDuel(target: string) {
    if (!duel) return;
    await supabase.rpc("vote_duel", { did: duel.id, target });
    void loadDuel();
  }

  // Realtime: ölglasets fyllnadsgrad och tidsgräns delas av alla medlemmar via gruppraden.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`group:${groupId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "groups", filter: `id=eq.${groupId}` },
        (payload) => {
          const oldRow = payload.old as Partial<Group>;
          const newRow = payload.new as Group;
          setGroup((prev) => (prev ? { ...prev, ...newRow } : newRow));

          const oldSize = oldRow.beer_glass_size as BeerGlassSize | null | undefined;
          const oldFill = oldRow.beer_fill_cl;
          const oldDuration = oldRow.beer_duration_minutes;
          if (
            oldSize &&
            typeof oldFill === "number" &&
            oldFill >= BEER_GLASSES[oldSize].capacityCl &&
            newRow.beer_fill_cl === 0
          ) {
            const glass = BEER_GLASSES[oldSize];
            const bonus = oldDuration ? (BEER_DURATION_BONUS[oldDuration] ?? 0) : 0;
            const reward = glass.points + bonus;
            setCelebration(
              `🍻 ${glass.label} är fullt! Alla i chatten får +${reward} ${settingsRef.current.currency}.`,
            );
            setTimeout(() => setCelebration(null), 4000);
            void loadLeaderboard();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, loadLeaderboard]);

  // Realtime: aktiveringar startas/avslutas (av cron eller admin) + deltaganden.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`activations:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_activations",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const wasActive = activationRef.current?.status === "active";
          const nowCompleted = (payload.new as GroupActivation)?.status === "completed";
          void loadActivation();
          if (wasActive && nowCompleted) void loadLeaderboard();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activation_participations" },
        (payload) => {
          const aid =
            (payload.new as ActivationParticipation)?.activation_id ??
            (payload.old as ActivationParticipation)?.activation_id;
          if (aid && aid === activationRef.current?.id) void loadActivation();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, loadActivation, loadLeaderboard]);

  function handleKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (Platform.OS !== "web") return;
    // På webben förmedlar react-native-web den riktiga DOM-KeyboardEvent här,
    // med fler fält (shiftKey, preventDefault) än RN:s officiella typ medger.
    const native = e.nativeEvent as unknown as KeyboardEvent;
    if (native.key === "Enter" && !native.shiftKey) {
      native.preventDefault();
      send();
    }
    if (native.key === "Escape") {
      setReplyTo(null);
      if (editingMsg) cancelEdit();
    }
  }

  /** Optimistisk sändning: bubblan syns direkt (🕒), misslyckande ger ⚠️ med
   *  Försök igen/Ta bort. Realtime-INSERT dedupliceras på riktiga id:t. */
  async function deliver(tempId: string, content: string, replyToId: string | null) {
    if (!userId || !groupId) return;
    const lower = content.toLowerCase();
    const mentions = Object.entries(namesRef.current)
      .filter(([, name]) => lower.includes("@" + name.toLowerCase()))
      .map(([uid]) => uid);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        group_id: groupId,
        user_id: userId,
        content,
        reply_to_id: replyToId,
        metadata: mentions.length ? { mentions } : {},
      })
      .select("*")
      .single();

    setMessages((prev) => {
      if (error || !data) {
        return prev.map((m) =>
          m.id === tempId ? ({ ...m, pending: false, failed: true } as MessageWithAuthor) : m,
        );
      }
      const real = { ...(data as Message), author_name: namesRef.current[userId] ?? "Jag" };
      // Realtime kan ha hunnit före — då bara släpps temp-raden.
      const withoutTemp = prev.filter((m) => m.id !== tempId);
      return withoutTemp.some((m) => m.id === real.id) ? withoutTemp : [real, ...withoutTemp];
    });
  }

  function send() {
    if (editingMsg) {
      void saveEdit();
      return;
    }
    const content = text.trim();
    if (!content || !userId || !groupId) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const replyToId = replyTo?.id ?? null;
    const temp: LocalMsg = {
      id: tempId,
      group_id: groupId,
      user_id: userId,
      content,
      kind: "user",
      metadata: {},
      reply_to_id: replyToId,
      created_at: new Date().toISOString(),
      author_name: namesRef.current[userId] ?? "Jag",
      pending: true,
    } as LocalMsg;
    setMessages((prev) => [temp as MessageWithAuthor, ...prev]);
    setText("");
    setReplyTo(null);
    buzz(8);
    void deliver(tempId, content, replyToId);
  }

  function retryMessage(msg: LocalMsg) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id ? ({ ...m, pending: true, failed: false } as MessageWithAuthor) : m,
      ),
    );
    void deliver(msg.id, msg.content, msg.reply_to_id ?? null);
  }

  function removeLocalMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function sendMediaMessage(
    kind: "image" | "audio",
    source: string | Blob,
    mime: string,
    fallback: string,
    extraMeta: Record<string, unknown> = {},
  ) {
    if (!groupId || !userId || uploadingMedia) return;
    setUploadingMedia(true);
    try {
      const path = await uploadChatMedia(groupId, userId, source, mime);
      await supabase.from("messages").insert({
        group_id: groupId,
        user_id: userId,
        content: fallback,
        kind,
        metadata: { media_path: path, mime, ...extraMeta },
      });
    } finally {
      setUploadingMedia(false);
    }
  }

  async function pickChatImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAttachOpen(false);
    await sendMediaMessage("image", asset.uri, asset.mimeType ?? "image/jpeg", "📷 Bild");
  }

  async function takeChatPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAttachOpen(false);
    await sendMediaMessage("image", asset.uri, asset.mimeType ?? "image/jpeg", "📷 Bild");
  }

  function cancelRecording() {
    if (!recording) return;
    discardRecordingRef.current = true;
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function toggleRecording() {
    // Inspelning via webbens MediaRecorder — native kräver expo-av och tas separat.
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recordStartRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordChunksRef.current, { type: mime });
        const durationMs = Date.now() - recordStartRef.current;
        if (blob.size > 0) {
          void sendMediaMessage("audio", blob, mime, "🎤 Röstmemo", { duration_ms: durationMs });
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      // Mikrofonåtkomst nekad — inget att göra.
    }
  }

  async function createPoll() {
    if (!groupId) return;
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    const { error } = await supabase.rpc("create_poll", {
      gid: groupId,
      question: q,
      options: opts,
    });
    if (!error) {
      setPollModalOpen(false);
      setPollQuestion("");
      setPollOptions(["", "", "", ""]);
      setAttachOpen(false);
    }
  }

  async function votePoll(pollId: string, optionId: string) {
    await supabase.rpc("vote_poll", { pid: pollId, oid: optionId });
  }

  async function participateThumb() {
    if (!activation || activationBusy) return;
    setActivationBusy(true);
    try {
      await supabase.rpc("submit_activation", { aid: activation.id });
      await loadActivation();
    } finally {
      setActivationBusy(false);
    }
  }

  async function participateFart() {
    if (!activation || !groupId || !userId || activationBusy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setActivationBusy(true);
    try {
      let durationMs = Math.round(asset.duration ?? 0);
      if (!durationMs) durationMs = await videoDurationMs(asset.uri);
      if (!durationMs) {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert("Kunde inte läsa inspelningens längd. Prova en annan fil.");
        }
        return;
      }
      const path = await uploadActivationMedia(
        activation.id,
        groupId,
        userId,
        asset.uri,
        asset.mimeType ?? "video/mp4",
      );
      await supabase.rpc("submit_activation", {
        aid: activation.id,
        media_path: path,
        duration_ms: durationMs,
      });
      await loadActivation();
    } finally {
      setActivationBusy(false);
    }
  }

  async function adminStartActivation() {
    if (!groupId || activationBusy || activation) return;
    setActivationBusy(true);
    try {
      await supabase.rpc("admin_start_activation", { gid: groupId });
      await loadActivation();
      setSettingsOpen(false);
    } finally {
      setActivationBusy(false);
    }
  }

  async function adminCompleteActivation() {
    if (!activation || activationBusy) return;
    setActivationBusy(true);
    try {
      await supabase.rpc("admin_complete_activation", { aid: activation.id });
      await loadActivation();
      await loadLeaderboard();
    } finally {
      setActivationBusy(false);
    }
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
    void loadReactionsFor(older.map((m) => m.id));
    void loadPolls(pollIdsIn(older));
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

  // Läsbockar visas bara på ditt senaste meddelande (Messenger-stil).
  const latestOwnId = messages.find((m) => m.user_id === userId && m.kind === "user")?.id;

  // Stabil åtgärdsyta för de memoiserade raderna: identiteten ändras aldrig,
  // men anropen går alltid till senaste renderns färska closures via ref.
  const rowActionsLiveRef = useRef<RowActions>(null as unknown as RowActions);
  rowActionsLiveRef.current = {
    openMenu: (m) => {
      buzz(12);
      setMenuMsg(m);
    },
    tap: onBubbleTap,
    reply: (m) => setReplyTo(m),
    toggleReaction: (id, key) => void toggleReaction(id, key),
    votePoll: (pid, oid) => void votePoll(pid, oid),
    retry: retryMessage,
    removeLocal: removeLocalMessage,
    openChallenge: (cid) =>
      router.push({ pathname: "/challenges/[id]", params: { id: cid } }),
  };
  const rowActions = useRef<RowActions>({
    openMenu: (m) => rowActionsLiveRef.current.openMenu(m),
    tap: (m, mine) => rowActionsLiveRef.current.tap(m, mine),
    reply: (m) => rowActionsLiveRef.current.reply(m),
    toggleReaction: (id, key) => rowActionsLiveRef.current.toggleReaction(id, key),
    votePoll: (pid, oid) => rowActionsLiveRef.current.votePoll(pid, oid),
    retry: (m) => rowActionsLiveRef.current.retry(m),
    removeLocal: (id) => rowActionsLiveRef.current.removeLocal(id),
    openChallenge: (cid) => rowActionsLiveRef.current.openChallenge(cid),
  }).current;

  sendMediaRef.current = sendMediaMessage;

  const chatBody = (
    <>
      <View style={styles.flex}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          inverted
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews={Platform.OS !== "web"}
          scrollEventThrottle={100}
          onScroll={(e) => {
            const away = e.nativeEvent.contentOffset.y > 250;
            awayRef.current = away;
            if (away !== awayFromBottom) setAwayFromBottom(away);
            if (!away && newWhileAway) setNewWhileAway(0);
          }}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
            });
          }}
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
            const parent = item.reply_to_id
              ? messages.find((m) => m.id === item.reply_to_id)
              : undefined;
            return (
              <ChatMessageRow
                item={item as LocalMsg}
                mine={mine}
                authorName={!mine && item.kind !== "system" ? item.author_name : null}
                authorTitle={
                  !mine && item.kind !== "system"
                    ? titleForPoints(memberPoints[item.user_id] ?? 0)
                    : null
                }
                parentAuthor={parent?.author_name ?? null}
                parentContent={parent?.content ?? null}
                bubbleColor={settings.color}
                c={c}
                bucket={reactions[item.id]}
                isLatestOwn={item.id === latestOwnId}
                readUpTo={othersReadUpTo}
                poll={
                  item.kind === "poll" && item.metadata?.poll_id
                    ? (polls[item.metadata.poll_id as string] ?? null)
                    : null
                }
                highlighted={item.id === currentMatchId}
                act={rowActions}
              />
            );
          }}
        />
      )}
      {awayFromBottom ? (
        <Pressable onPress={jumpToBottom} style={[styles.jumpBtn, { backgroundColor: settings.color }]}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>
            ↓{newWhileAway > 0 ? ` ${newWhileAway} ny${newWhileAway > 1 ? "a" : "tt"}` : ""}
          </Text>
        </Pressable>
      ) : null}
      </View>

      {typingName ? (
        <View style={[styles.typingRow, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
          <Text style={{ color: c.textSecondary, fontSize: 12, fontStyle: "italic" }}>
            {typingName} skriver
          </Text>
          <TypingDots color={c.textSecondary} />
        </View>
      ) : null}

      {editingMsg ? (
        <View style={[styles.replyPreview, { backgroundColor: c.backgroundElement }]}>
          <View style={styles.flex}>
            <Text style={{ color: c.brand, fontWeight: "700", fontSize: 12 }}>
              ✏️ Redigerar meddelande
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12 }} numberOfLines={1}>
              {editingMsg.content}
            </Text>
          </View>
          <Pressable onPress={cancelEdit} hitSlop={12}>
            <Text style={{ color: c.textSecondary, fontSize: 18 }}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {replyTo ? (
        <View style={[styles.replyPreview, { backgroundColor: c.backgroundElement }]}>
          <View style={styles.flex}>
            <Text style={{ color: c.brand, fontWeight: "700", fontSize: 12 }}>
              Svarar {replyTo.author_name}
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12 }} numberOfLines={1}>
              {replyTo.content}
            </Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Text style={{ color: c.textSecondary, fontSize: 18 }}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {attachOpen ? (
        <View style={[styles.attachRow, { borderTopColor: c.backgroundElement }]}>
          <Pressable onPress={takeChatPhoto} style={styles.attachBtn} disabled={uploadingMedia}>
            <Text style={styles.attachEmoji}>📸</Text>
            <Text style={[styles.attachLabel, { color: c.textSecondary }]}>Kamera</Text>
          </Pressable>
          <Pressable onPress={pickChatImage} style={styles.attachBtn} disabled={uploadingMedia}>
            <Text style={styles.attachEmoji}>🖼️</Text>
            <Text style={[styles.attachLabel, { color: c.textSecondary }]}>Bild</Text>
          </Pressable>
          <Pressable onPress={() => setPollModalOpen(true)} style={styles.attachBtn}>
            <Text style={styles.attachEmoji}>📊</Text>
            <Text style={[styles.attachLabel, { color: c.textSecondary }]}>Omröstning</Text>
          </Pressable>
        </View>
      ) : null}

      {emojiOpen ? (
        <View style={[styles.emojiRow, { borderTopColor: c.backgroundElement }]}>
          {QUICK_EMOJIS.map((emoji) => (
            <Pressable key={emoji} onPress={() => setText((t) => t + emoji)} hitSlop={4}>
              <Text style={{ fontSize: 24 }}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {recording ? (
        <View style={[styles.recordingBanner, styles.bannerRow]}>
          <Text style={[styles.recordingText, { flex: 1 }]}>
            🔴 Spelar in röstmemo… tryck ⏹ för att skicka
          </Text>
          <Pressable onPress={cancelRecording} hitSlop={12}>
            <Text style={{ fontSize: 18 }}>🗑</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Claude-lik komposer: textytan i full bredd överst, knapparna
          flytande i en rad under, och rutan växer med innehållet. */}
      <View style={styles.composerWrap}>
        <View
          style={[
            styles.composer,
            { backgroundColor: c.backgroundElement, borderColor: c.backgroundSelected },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={onTypeText}
            placeholder="Skriv ett meddelande…"
            placeholderTextColor={c.textSecondary}
            multiline
            onKeyPress={handleKeyPress}
            onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
            style={[
              styles.composerInput,
              { color: c.text },
              { height: Math.min(200, Math.max(24, inputHeight)) },
            ]}
          />
          <View style={styles.composerRow}>
            <Pressable
              onPress={() => {
                setStarOpen(true);
                setAttachOpen(false);
                setEmojiOpen(false);
              }}
              hitSlop={6}
              style={styles.composerBtn}
            >
              <Text style={{ color: settings.color, fontSize: 22, fontWeight: "700" }}>✦</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAttachOpen((v) => !v);
                setEmojiOpen(false);
              }}
              hitSlop={6}
              style={styles.composerBtn}
            >
              <Text style={{ color: settings.color, fontSize: 24, fontWeight: "700" }}>
                {attachOpen ? "×" : "＋"}
              </Text>
            </Pressable>
            <Pressable onPress={toggleRecording} hitSlop={6} style={styles.composerBtn}>
              <Text style={{ fontSize: 20 }}>{recording ? "⏹" : "🎤"}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setEmojiOpen((v) => !v);
                setAttachOpen(false);
              }}
              hitSlop={6}
              style={styles.composerBtn}
            >
              <Text style={{ fontSize: 20 }}>😊</Text>
            </Pressable>
            <View style={styles.flex} />
            {uploadingMedia ? (
              <ActivityIndicator style={{ marginRight: 6 }} />
            ) : null}
            <Pressable
              onPress={send}
              disabled={sending || text.trim().length === 0}
              style={[
                styles.sendCircle,
                {
                  backgroundColor: settings.color,
                  opacity: sending || text.trim().length === 0 ? 0.35 : 1,
                },
              ]}
            >
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>↑</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );

  const selectedDuration = group?.beer_duration_minutes ?? BEER_DURATION_OPTIONS[0];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.backgroundElement }]}>
        <Pressable
          // Alltid till chattöversikten — router.back() var ett no-op när
          // chatten öppnats direkt (t.ex. efter omladdning på webben) och
          // kunde annars hamna på andra skärmar ur historiken.
          onPress={() => router.replace("/groups")}
          hitSlop={6}
          style={styles.back}
        >
          <Text style={{ color: settings.color, fontSize: 28 }}>‹</Text>
          {unreadOther > 0 ? (
            <View style={styles.backBadge}>
              <Text style={styles.backBadgeText}>{unreadOther > 99 ? "99+" : unreadOther}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={() => setSettingsOpen(true)} style={styles.headerTitleZone}>
          <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
            {group?.name ?? ""}
          </Text>
          {typingName ? (
            <Text style={{ color: c.textSecondary, fontSize: 11 }} numberOfLines={1}>
              {typingName} skriver…
            </Text>
          ) : onlineOthers > 0 ? (
            <Text style={{ color: "#22c55e", fontSize: 11 }} numberOfLines={1}>
              🟢 {onlineOthers} aktiv{onlineOthers > 1 ? "a" : ""} nu
            </Text>
          ) : null}
        </Pressable>
        <Pressable onPress={() => noteCall(false)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>📞</Text>
        </Pressable>
        <Pressable onPress={() => noteCall(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>🎥</Text>
        </Pressable>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>

      {chatSearchOpen ? (
        <View style={[styles.chatSearchBar, { backgroundColor: c.backgroundElement }]}>
          <TextInput
            value={chatSearch}
            onChangeText={(t) => {
              setChatSearch(t);
              setMatchIdx(0);
            }}
            placeholder="Sök i chatten…"
            placeholderTextColor={c.textSecondary}
            autoFocus
            style={[styles.chatSearchInput, { color: c.text }]}
          />
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: "700" }}>
            {matchIndices.length === 0
              ? chatQuery
                ? "0/0"
                : ""
              : `${(matchIdx % matchIndices.length) + 1}/${matchIndices.length}`}
          </Text>
          <Pressable onPress={() => gotoMatch(1)} hitSlop={10} disabled={matchIndices.length === 0}>
            <Text style={{ color: c.text, fontSize: 17 }}>↑</Text>
          </Pressable>
          <Pressable onPress={() => gotoMatch(-1)} hitSlop={10} disabled={matchIndices.length === 0}>
            <Text style={{ color: c.text, fontSize: 17 }}>↓</Text>
          </Pressable>
          <Pressable onPress={closeChatSearch} hitSlop={10}>
            <Text style={{ color: c.textSecondary, fontSize: 18 }}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Gemensam energibar: fylls av aktivitet, sjunker vid tystnad. */}
      <View style={[styles.energyTrack, { backgroundColor: c.backgroundElement }]}>
        <View
          style={[
            styles.energyFill,
            {
              width: `${energyNow}%`,
              backgroundColor: powerHourActive ? "#f2a916" : energyNow >= 80 ? "#22c55e" : settings.color,
            },
          ]}
        />
      </View>

      {celebration ? (
        <View style={styles.celebrationBanner}>
          <Text style={styles.celebrationText}>{celebration}</Text>
        </View>
      ) : null}

      {callNote ? (
        <View style={styles.celebrationBanner}>
          <Text style={styles.celebrationText}>{callNote}</Text>
        </View>
      ) : null}

      {powerHourActive && !dismissed[`ph:${powerHourEndsAt}`] ? (
        <View style={[styles.powerHourBanner, styles.bannerRow]}>
          <Text style={[styles.powerHourText, { flex: 1 }]}>
            ⚡ POWER HOUR — dubbel XP! {formatCountdown(powerHourRemainingMs)} kvar
          </Text>
          <Pressable onPress={() => dismissBanner(`ph:${powerHourEndsAt}`)} hitSlop={10}>
            <Text style={[styles.bannerClose, { color: "#2a1a10" }]}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {streak &&
      streak.current_streak > 0 &&
      streak.last_checkin !== new Date().toISOString().slice(0, 10) &&
      !dismissed[`streak:${new Date().toISOString().slice(0, 10)}`] ? (
        <View style={[styles.streakWarning, styles.bannerRow]}>
          <Pressable onPress={checkin} style={{ flex: 1 }}>
            <Text style={styles.streakWarningText}>
              🔥 Din {streak.current_streak}-dagarsstreak ryker om du inte checkar in idag — tryck
              här!
            </Text>
          </Pressable>
          <Pressable
            onPress={() => dismissBanner(`streak:${new Date().toISOString().slice(0, 10)}`)}
            hitSlop={10}
          >
            <Text style={styles.bannerClose}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {quest && !questDone && !dismissed[`quest:${new Date().toISOString().slice(0, 10)}:${quest.quest_id}`] ? (
        <View style={[styles.questStrip, { backgroundColor: c.backgroundElement }]}>
          <Text style={[styles.questText, { color: c.text }]} numberOfLines={1}>
            🎯 {quest.title}
          </Text>
          <Pressable
            onPress={completeQuest}
            style={[styles.questBtn, { backgroundColor: settings.color }]}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
              Klar +{quest.bonus}p
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              dismissBanner(`quest:${new Date().toISOString().slice(0, 10)}:${quest.quest_id}`)
            }
            hitSlop={10}
          >
            <Text style={[styles.bannerClose, { color: c.textSecondary }]}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {duel && !dismissed[`duel:${duel.id}:${duel.status}`] ? (
        <View style={[styles.duelBanner, { backgroundColor: "#7c2d12" }]}>
          {!(duel.status === "pending" && duel.opponent_id === userId) ? (
            <Pressable
              onPress={() => dismissBanner(`duel:${duel.id}:${duel.status}`)}
              hitSlop={10}
              style={styles.bannerCloseCorner}
            >
              <Text style={styles.bannerClose}>×</Text>
            </Pressable>
          ) : null}
          {duel.status === "pending" ? (
            <>
              <Text style={styles.duelText}>
                ⚔️ {namesRef.current[duel.challenger_id] ?? "?"} utmanar{" "}
                {namesRef.current[duel.opponent_id] ?? "?"} om {duel.stake}p
              </Text>
              {duel.opponent_id === userId ? (
                <View style={styles.duelActions}>
                  <Pressable onPress={() => respondDuel(true)} style={styles.duelBtn}>
                    <Text style={styles.duelBtnText}>Acceptera</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respondDuel(false)}
                    style={[styles.duelBtn, { backgroundColor: "transparent" }]}
                  >
                    <Text style={[styles.duelBtnText, { color: "#fca5a5" }]}>Neka</Text>
                  </Pressable>
                </View>
              ) : duel.challenger_id === userId ? (
                <View style={styles.duelActions}>
                  <Text style={styles.duelSub}>Väntar på svar…</Text>
                  <Pressable
                    onPress={cancelDuel}
                    style={[styles.duelBtn, { backgroundColor: "transparent" }]}
                  >
                    <Text style={[styles.duelBtnText, { color: "#fca5a5" }]}>
                      ↩️ Avbryt utmaningen
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.duelSub}>Väntar på svar…</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.duelText}>
                ⚔️ {namesRef.current[duel.challenger_id] ?? "?"} ({duelVotes.ch}) vs{" "}
                {namesRef.current[duel.opponent_id] ?? "?"} ({duelVotes.op}) · pott {duel.stake * 2}p ·{" "}
                {formatCountdown(duelRemainingMs)}
              </Text>
              {userId !== duel.challenger_id && userId !== duel.opponent_id ? (
                <View style={styles.duelActions}>
                  <Pressable
                    onPress={() => voteDuel(duel.challenger_id)}
                    style={[
                      styles.duelBtn,
                      duelVotes.mine === duel.challenger_id ? styles.duelBtnSelected : null,
                    ]}
                  >
                    <Text style={styles.duelBtnText}>
                      {namesRef.current[duel.challenger_id] ?? "?"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => voteDuel(duel.opponent_id)}
                    style={[
                      styles.duelBtn,
                      duelVotes.mine === duel.opponent_id ? styles.duelBtnSelected : null,
                    ]}
                  >
                    <Text style={styles.duelBtnText}>
                      {namesRef.current[duel.opponent_id] ?? "?"}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.duelSub}>Gruppen röstar — håll tummarna!</Text>
              )}
            </>
          )}
        </View>
      ) : null}

      {activation && !dismissed[`act:${activation.id}`] ? (
        <View style={[styles.activationCard, { backgroundColor: c.brand }]}>
          <View style={styles.activationTop}>
            <Text style={styles.activationTitle} numberOfLines={1}>
              {ACTIVATION_KINDS[activation.kind]?.emoji} {activation.name}
            </Text>
            <Text style={styles.activationTimer}>⏳ {formatRemaining(activationRemainingMs)}</Text>
            <Pressable onPress={() => dismissBanner(`act:${activation.id}`)} hitSlop={10}>
              <Text style={styles.bannerClose}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.activationBlurb}>
            {ACTIVATION_KINDS[activation.kind]?.blurb}
          </Text>
          <View style={styles.activationActions}>
            {myParticipation ? (
              <Text style={styles.activationDone}>
                ✓ Du har deltagit
                {activation.kind === "longest_fart" && myParticipation.duration_ms
                  ? ` (${formatDuration(myParticipation.duration_ms)})`
                  : ""}
              </Text>
            ) : (
              <Pressable
                onPress={activation.kind === "longest_fart" ? participateFart : participateThumb}
                disabled={activationBusy}
                style={[styles.activationBtn, { opacity: activationBusy ? 0.6 : 1 }]}
              >
                <Text style={[styles.activationBtnText, { color: c.brand }]}>
                  {activationBusy
                    ? "Skickar…"
                    : activation.kind === "longest_fart"
                      ? "💨 Ladda upp prutt"
                      : "👍 Skicka tumme"}
                </Text>
              </Pressable>
            )}
            <Text style={styles.activationCount}>
              {participations.length} {participations.length === 1 ? "deltagare" : "deltagare"}
            </Text>
          </View>
          {isAdmin ? (
            <Pressable onPress={adminCompleteActivation} disabled={activationBusy} hitSlop={6}>
              <Text style={styles.activationAdmin}>Avsluta &amp; dela ut poäng nu →</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        {group?.beer_glass_size ? (
          <BeerGlassBackground
            size={group.beer_glass_size}
            fillCl={group.beer_fill_cl}
            remainingMs={beerRemainingMs}
            style={styles.flex}
          >
            {chatBody}
          </BeerGlassBackground>
        ) : (
          <ChatBackground
            image={settings.backgroundImage}
            color={settings.background}
            style={styles.flex}
          >
            {chatBody}
          </ChatBackground>
        )}
      </KeyboardAvoidingView>

      {/* Långtrycksmeny på meddelande: snabbreaktioner + åtgärder. */}
      <Modal
        visible={!!menuMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuMsg(null)}
      >
        <Pressable style={styles.ctxBackdrop} onPress={() => setMenuMsg(null)}>
          {menuMsg ? (
            <Pressable style={[styles.ctxCard, { backgroundColor: c.background }]} onPress={() => {}}>
              <View
                style={[
                  styles.ctxPreview,
                  { backgroundColor: menuMsg.user_id === userId ? settings.color : c.backgroundElement },
                ]}
              >
                <Text
                  style={{ color: menuMsg.user_id === userId ? "#fff" : c.text, fontSize: 14 }}
                  numberOfLines={3}
                >
                  {menuMsg.content}
                </Text>
              </View>
              {menuMsg.user_id !== userId ? (
                <View style={styles.ctxReactions}>
                  {REACTION_ORDER.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => {
                        buzz(8);
                        void toggleReaction(menuMsg.id, key);
                        setMenuMsg(null);
                      }}
                      hitSlop={6}
                      style={styles.ctxReaction}
                    >
                      <Text style={{ fontSize: 26 }}>{REACTIONS[key].emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable
                onPress={() => {
                  setReplyTo(menuMsg);
                  setMenuMsg(null);
                }}
                style={[styles.ctxAction, { borderTopColor: c.backgroundElement }]}
              >
                <Text style={[styles.ctxActionText, { color: c.text }]}>↩︎ Svara</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void copyMessage(menuMsg);
                  setMenuMsg(null);
                }}
                style={[styles.ctxAction, { borderTopColor: c.backgroundElement }]}
              >
                <Text style={[styles.ctxActionText, { color: c.text }]}>📋 Kopiera text</Text>
              </Pressable>
              {menuMsg.kind === "user" && !menuMsg.pending && !menuMsg.failed ? (
                <Pressable
                  onPress={() => {
                    void openForward(menuMsg);
                    setMenuMsg(null);
                  }}
                  style={[styles.ctxAction, { borderTopColor: c.backgroundElement }]}
                >
                  <Text style={[styles.ctxActionText, { color: c.text }]}>↪️ Vidarebefordra</Text>
                </Pressable>
              ) : null}
              {menuMsg.user_id === userId &&
              menuMsg.kind === "user" &&
              !menuMsg.pending &&
              !menuMsg.failed &&
              Date.now() - new Date(menuMsg.created_at).getTime() < 15 * 60_000 ? (
                <Pressable
                  onPress={() => {
                    startEdit(menuMsg);
                    setMenuMsg(null);
                  }}
                  style={[styles.ctxAction, { borderTopColor: c.backgroundElement }]}
                >
                  <Text style={[styles.ctxActionText, { color: c.text }]}>✏️ Redigera</Text>
                </Pressable>
              ) : null}
              {menuMsg.user_id === userId && !menuMsg.pending && !menuMsg.failed ? (
                <Pressable
                  onPress={() => {
                    void deleteMessage(menuMsg);
                    setMenuMsg(null);
                  }}
                  style={[styles.ctxAction, { borderTopColor: c.backgroundElement }]}
                >
                  <Text style={[styles.ctxActionText, { color: "#dc2626" }]}>🗑 Ta bort</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* Vidarebefordra: välj grupp. */}
      <Modal
        visible={!!forwardMsg}
        transparent
        animationType="slide"
        onRequestClose={() => setForwardMsg(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setForwardMsg(null)}>
          <View style={{ flex: 1 }} />
          <Pressable style={[styles.starSheet, { backgroundColor: c.background }]} onPress={() => {}}>
            <Text style={[styles.starTitle, { color: c.text }]}>↪️ Vidarebefordra till…</Text>
            {forwardGroups.length === 0 ? (
              <Text style={{ color: c.textSecondary, fontSize: 13, textAlign: "center" }}>
                Du har inga andra grupper att skicka till.
              </Text>
            ) : (
              forwardGroups.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => void forwardTo(g.id)}
                  style={[styles.starItem, { backgroundColor: c.backgroundElement }]}
                >
                  <Text style={{ fontSize: 20 }}>💬</Text>
                  <Text style={[styles.starLabel, { color: c.text }]}>{g.name}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 18 }}>›</Text>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ✦ Startmenyn: allt man kan dra igång i gruppen, Messenger-stil. */}
      <Modal
        visible={starOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setStarOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setStarOpen(false)}>
          <View style={{ flex: 1 }} />
          <Pressable style={[styles.starSheet, { backgroundColor: c.background }]} onPress={() => {}}>
            <Text style={[styles.starTitle, { color: c.text }]}>Starta något</Text>
            {(
              [
                { emoji: "🎮", label: "Spel & lekar", action: () => setGameOpen(true) },
                {
                  emoji: "🃏",
                  label: "Poängjakten",
                  action: () =>
                    groupId && router.push({ pathname: "/hunt", params: { groupId } }),
                },
                { emoji: "⚔️", label: "Utmana på duell", action: () => setDuelModalOpen(true) },
                { emoji: "📊", label: "Omröstning", action: () => setPollModalOpen(true) },
                {
                  emoji: "🔥",
                  label: `Checka in streak (${streak?.current_streak ?? 0} dagar)`,
                  action: checkin,
                },
                { emoji: "🏆", label: "Turneringar & topplista", action: () => router.push("/feed") },
                { emoji: "🔍", label: "Sök i chatten", action: () => setChatSearchOpen(true) },
                {
                  emoji: "🔗",
                  label: linkCopied ? "Länk kopierad!" : "Bjud in en polare",
                  action: invite,
                },
              ] as { emoji: string; label: string; action: () => void }[]
            ).map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setStarOpen(false);
                  item.action();
                }}
                style={[styles.starItem, { backgroundColor: c.backgroundElement }]}
              >
                <Text style={{ fontSize: 24 }}>{item.emoji}</Text>
                <Text style={[styles.starLabel, { color: c.text }]}>{item.label}</Text>
                <Text style={{ color: c.textSecondary, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

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
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: c.text, flex: 1 }]}>
              Inställningar för chatten
            </Text>
            <Pressable
              onPress={() => setSettingsOpen(false)}
              hitSlop={12}
              style={styles.sheetCloseBtn}
            >
              <Text style={{ color: c.textSecondary, fontSize: 24, fontWeight: "700" }}>×</Text>
            </Pressable>
          </View>

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

          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
            Öl-mode 🍺 (1 cl per meddelande, delad mellan alla i chatten)
          </Text>
          <View style={styles.beerPickerRow}>
            <Pressable
              onPress={() => setBeerGlass(null, selectedDuration)}
              style={[
                styles.beerOption,
                { borderColor: c.backgroundSelected },
                !group?.beer_glass_size ? styles.beerOptionSelected : null,
              ]}
            >
              <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>Av</Text>
            </Pressable>
            {(Object.keys(BEER_GLASSES) as BeerGlassSize[]).map((size) => {
              const glass = BEER_GLASSES[size];
              return (
                <Pressable
                  key={size}
                  onPress={() => setBeerGlass(size, selectedDuration)}
                  style={[
                    styles.beerOption,
                    { borderColor: c.backgroundSelected },
                    group?.beer_glass_size === size ? styles.beerOptionSelected : null,
                  ]}
                >
                  <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>
                    {glass.label}
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 11 }}>
                    {glass.capacityCl} cl · +{glass.points}p
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {group?.beer_glass_size ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
                Tid (nollställer och startar om rundan)
              </Text>
              <View style={styles.swatchRow}>
                {BEER_DURATION_OPTIONS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    onPress={() => setBeerGlass(group.beer_glass_size, minutes)}
                    style={[
                      styles.chip,
                      { borderColor: c.backgroundSelected },
                      selectedDuration === minutes
                        ? { backgroundColor: settings.color, borderColor: settings.color }
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: selectedDuration === minutes ? "#fff" : c.text },
                      ]}
                    >
                      {minutes} min
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.pointsText, { color: c.textSecondary }]}>
                Fullt glas ger {BEER_GLASSES[group.beer_glass_size].points +
                  (BEER_DURATION_BONUS[selectedDuration] ?? 0)}{" "}
                {settings.currency} till alla — hinner ni inte i tid nollställs glaset utan
                belöning.
              </Text>
            </>
          ) : null}

          {isAdmin ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
                Aktivera chatten 💤 (tävlingsledning)
              </Text>
              <Pressable
                onPress={adminStartActivation}
                disabled={activationBusy || !!activation}
                style={[
                  styles.beerOption,
                  {
                    borderColor: c.backgroundSelected,
                    alignItems: "center",
                    opacity: activationBusy || activation ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>
                  {activation ? "Aktivering redan igång" : "Starta aktivering nu"}
                </Text>
              </Pressable>
            </>
          ) : null}

          {teamScore ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Teampoäng</Text>
              <View style={styles.leaderboardRow}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: "800" }}>
                  🛡 {teamScore.total} teampoäng
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                  {teamScore.member} individuellt + {teamScore.team} team
                </Text>
              </View>
            </>
          ) : null}

          {leaderboard.length > 0 ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Poäng</Text>
              <View style={styles.leaderboard}>
                {leaderboard.map((row) => (
                  <View key={row.userId} style={styles.leaderboardRow}>
                    <Text style={{ color: c.text, fontSize: 13 }}>
                      {row.name} · {titleForPoints(row.points)}
                    </Text>
                    <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: "700" }}>
                      {row.points} {settings.currency}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {weekly.length > 0 ? (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
                Veckans topplista (nollställs varje måndag)
              </Text>
              <View style={styles.leaderboard}>
                {weekly.map((row, i) => (
                  <View key={row.userId} style={styles.leaderboardRow}>
                    <Text style={{ color: c.text, fontSize: 13 }}>
                      {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}
                      {row.name}
                    </Text>
                    <Text style={{ color: c.textSecondary, fontSize: 13, fontWeight: "700" }}>
                      +{row.points}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {gotw ? (
            <Text style={[styles.pointsText, { color: c.text, fontWeight: "700" }]}>
              👑 Grabb of the Week: {namesRef.current[gotw] ?? "?"}
            </Text>
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

      <Modal
        visible={pollModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPollModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPollModalOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          <Text style={[styles.sheetTitle, { color: c.text }]}>📊 Skapa omröstning</Text>
          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Fråga</Text>
          <TextInput
            value={pollQuestion}
            onChangeText={setPollQuestion}
            placeholder="Vem bjuder på nästa runda?"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected, flex: 0 }]}
          />
          <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
            Alternativ (minst 2)
          </Text>
          {pollOptions.map((opt, i) => (
            <TextInput
              key={i}
              value={opt}
              onChangeText={(v) =>
                setPollOptions((prev) => prev.map((p, j) => (j === i ? v : p)))
              }
              placeholder={`Alternativ ${i + 1}${i < 2 ? "" : " (valfritt)"}`}
              placeholderTextColor={c.textSecondary}
              style={[
                styles.input,
                { color: c.text, borderColor: c.backgroundSelected, flex: 0, marginBottom: 8 },
              ]}
            />
          ))}
          <Pressable
            onPress={createPoll}
            disabled={
              !pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2
            }
            style={[
              styles.closeBtn,
              {
                backgroundColor: settings.color,
                opacity:
                  pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2
                    ? 1
                    : 0.4,
              },
            ]}
          >
            <Text style={styles.sendText}>Starta omröstning</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal
        visible={duelModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDuelModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDuelModalOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          <Text style={[styles.sheetTitle, { color: c.text }]}>⚔️ Utmana på duell</Text>
          {duel ? (
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              Det pågår redan en duell i gruppen — vänta tills den är avgjord.
            </Text>
          ) : (
            <>
              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>Motståndare</Text>
              <View style={styles.swatchRow}>
                {leaderboard
                  .filter((m) => m.userId !== userId)
                  .map((m) => (
                    <Pressable
                      key={m.userId}
                      onPress={() => setDuelOpponent(m.userId)}
                      style={[
                        styles.chip,
                        { borderColor: c.backgroundSelected },
                        duelOpponent === m.userId
                          ? { backgroundColor: settings.color, borderColor: settings.color }
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: duelOpponent === m.userId ? "#fff" : c.text },
                        ]}
                      >
                        {m.name} ({m.points}p)
                      </Text>
                    </Pressable>
                  ))}
              </View>

              <Text style={[styles.sheetLabel, { color: c.textSecondary }]}>
                Insats (dras från er båda, vinnaren tar allt)
              </Text>
              <TextInput
                value={duelStake}
                onChangeText={setDuelStake}
                keyboardType="number-pad"
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected, flex: 0 }]}
              />

              <Pressable
                onPress={createDuel}
                disabled={!duelOpponent}
                style={[
                  styles.closeBtn,
                  { backgroundColor: settings.color, opacity: duelOpponent ? 1 : 0.4 },
                ]}
              >
                <Text style={styles.sendText}>Skicka utmaning</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>

      {groupId ? (
        <GameCenter
          visible={gameOpen}
          onClose={() => setGameOpen(false)}
          groupId={groupId}
          members={leaderboard.map((m) => ({ id: m.userId, name: m.name }))}
        />
      ) : null}
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
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    justifyContent: "flex-start",
  },
  headerTitleZone: { flex: 1, marginLeft: 10, justifyContent: "center", minHeight: 44 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetCloseBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backBadge: {
    backgroundColor: "#dc2626",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  backBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  gear: { paddingHorizontal: 4 },
  starSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 8,
    paddingBottom: 28,
  },
  starTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4, textAlign: "center" },
  starItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  starLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
  },
  msgStatus: { fontSize: 11, marginTop: 2 },
  swipeReply: { justifyContent: "center", paddingHorizontal: 18 },
  failedRow: { flexDirection: "row", gap: 10, marginTop: 3, alignItems: "center" },
  typingRow: { paddingHorizontal: 16, paddingVertical: 4 },
  lightbox: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImage: { width: "100%", height: "100%" },
  lightboxClose: { position: "absolute", top: 40, right: 20 },
  ctxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  ctxCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 18,
    overflow: "hidden",
  },
  ctxPreview: { padding: 14 },
  ctxReactions: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  ctxReaction: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  ctxAction: { paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: 1 },
  ctxActionText: { fontSize: 15, fontWeight: "600" },
  listContent: { padding: 12, gap: 8 },
  empty: { textAlign: "center", marginTop: 40, transform: [{ scaleY: -1 }] },
  msgRow: { maxWidth: "82%" },
  systemPill: {
    alignSelf: "center",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 4,
  },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  author: { fontSize: 12, marginBottom: 2, marginLeft: 6 },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  reactionRow: { flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap" },
  reactionChip: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  quoteBox: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  quoteAuthor: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700" },
  quoteContent: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  replyPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  energyTrack: { height: 5, width: "100%" },
  energyFill: { height: 5 },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bannerClose: { color: "rgba(255,255,255,0.85)", fontSize: 20, fontWeight: "700", lineHeight: 22 },
  bannerCloseCorner: { position: "absolute", top: 6, right: 10, zIndex: 1 },
  powerHourBanner: { backgroundColor: "#f2a916", paddingHorizontal: 16, paddingVertical: 8 },
  powerHourText: { color: "#2a1a10", fontWeight: "900", textAlign: "center", fontSize: 13 },
  streakWarning: { backgroundColor: "#7f1d1d", paddingHorizontal: 16, paddingVertical: 8 },
  streakWarningText: { color: "#fecaca", fontWeight: "700", textAlign: "center", fontSize: 12 },
  questStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  questText: { flex: 1, fontSize: 13, fontWeight: "600" },
  questBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  duelBanner: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  duelText: { color: "#fff", fontWeight: "800", fontSize: 13, textAlign: "center" },
  duelSub: { color: "#fed7aa", fontSize: 12, textAlign: "center" },
  duelActions: { flexDirection: "row", justifyContent: "center", gap: 12 },
  duelBtn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "transparent",
  },
  duelBtnSelected: { borderColor: "#f2a916", backgroundColor: "rgba(242,169,22,0.25)" },
  duelBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  gameHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  gameHeaderTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  gameContent: { padding: 20, gap: 12, flex: 1 },
  gameCategory: { color: "#c4b5fd", fontSize: 14, fontWeight: "800", marginTop: 8 },
  gameCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 16,
  },
  gameCardEmoji: { fontSize: 34 },
  gameCardTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  gameCardDesc: { color: "#c4b5fd", fontSize: 13, marginTop: 2 },
  gameSetupTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  gamePlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  gamePlayerRowSelected: { borderColor: "#f2a916" },
  gameOrderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f2a916",
    alignItems: "center",
    justifyContent: "center",
  },
  gameOrderText: { color: "#2a1a10", fontWeight: "900", fontSize: 13 },
  gamePlayerName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  gameStartBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
    paddingHorizontal: 24,
  },
  gameTurnLabel: { color: "#c4b5fd", fontSize: 14, textAlign: "center" },
  gameTurnName: { color: "#fff", fontSize: 28, fontWeight: "900", textAlign: "center" },
  gameCardArea: { alignItems: "center", marginVertical: 12 },
  playingCard: {
    width: 170,
    height: 240,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  playingCardCorner: {
    position: "absolute",
    top: 10,
    left: 12,
    fontSize: 22,
    fontWeight: "900",
  },
  playingCardSuit: { fontSize: 84 },
  cardBack: {
    width: 170,
    height: 240,
    backgroundColor: "#4c1d95",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 3,
    borderColor: "#7c3aed",
  },
  cardBackText: { color: "#c4b5fd", fontSize: 13, fontWeight: "700", textAlign: "center" },
  gameRuleBox: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  gameRuleTitle: { color: "#f2a916", fontSize: 16, fontWeight: "800" },
  gameRuleText: { color: "#fff", fontSize: 14, lineHeight: 20 },
  gameStatusRow: { flexDirection: "row", justifyContent: "space-between" },
  gameStatus: { color: "#c4b5fd", fontSize: 13, fontWeight: "700" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plusBtn: { paddingBottom: 9, paddingHorizontal: 2 },
  attachRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachBtn: { alignItems: "center", gap: 2, minWidth: 64 },
  attachEmoji: { fontSize: 26 },
  attachLabel: { fontSize: 11, fontWeight: "600" },
  emojiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recordingBanner: { backgroundColor: "#7f1d1d", paddingVertical: 6 },
  recordingText: { color: "#fecaca", fontWeight: "700", fontSize: 12, textAlign: "center" },
  chatImage: { width: 230, height: 230, borderRadius: 12 },
  audioBubble: {
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 200,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flex: 1,
    height: 22,
  },
  speedChip: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  composerWrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10 },
  composer: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 6,
  },
  composerInput: {
    fontSize: 15,
    lineHeight: 21,
    padding: 0,
    textAlignVertical: "top",
  },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  composerBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  sendCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpBtn: {
    position: "absolute",
    bottom: 14,
    right: 14,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 44,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  chatSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chatSearchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  pollBox: { minWidth: 230, gap: 6 },
  pollOption: {
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.25)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pollOptionMine: { borderColor: "#f2a916" },
  pollFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  pollOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  celebrationBanner: {
    backgroundColor: "#f2a916",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  celebrationText: { color: "#2a1a10", fontWeight: "800", textAlign: "center" },
  activationCard: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  activationTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  activationTitle: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 15 },
  activationTimer: { color: "#fff", fontWeight: "700", fontSize: 13 },
  activationBlurb: { color: "#eef", fontSize: 13 },
  activationActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  activationBtn: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  activationBtnText: { fontWeight: "800", fontSize: 14 },
  activationDone: { color: "#fff", fontWeight: "700", fontSize: 14 },
  activationCount: { color: "#eef", fontSize: 12 },
  activationAdmin: { color: "#fff", fontWeight: "700", fontSize: 12, textDecorationLine: "underline" },
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
  beerPickerRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  beerOption: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    gap: 2,
  },
  beerOptionSelected: {
    borderWidth: 2,
    borderColor: "#f2a916",
  },
  leaderboard: { gap: 6 },
  leaderboardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
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
