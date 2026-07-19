import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
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
  if (!url) return <ActivityIndicator style={{ margin: 24 }} />;
  return <Image source={{ uri: url }} style={styles.chatImage} resizeMode="cover" />;
}

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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    const url = await getChatMediaUrl(path);
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new window.Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    void audioRef.current.play();
    setPlaying(true);
  }

  return (
    <Pressable onPress={toggle} style={styles.audioBubble}>
      <Text style={{ color: tint, fontSize: 15, fontWeight: "700" }}>
        {playing ? "⏸" : "▶️"} Röstmemo
        {durationMs ? ` · ${formatCountdown(durationMs)}` : ""}
      </Text>
    </Pressable>
  );
}

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

  // Klockan tickar en gång i sekunden — driver öl-/aktiverings-/duell-nedräkning
  // och energibarens förfall.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
      void send();
    }
  }

  async function send() {
    const content = text.trim();
    if (!content || sending || !userId || !groupId) return;
    setSending(true);

    // @namn → user-id (matchar medlemmarnas visningsnamn, skiftlägesokänsligt).
    const lower = content.toLowerCase();
    const mentions = Object.entries(namesRef.current)
      .filter(([, name]) => lower.includes("@" + name.toLowerCase()))
      .map(([uid]) => uid);

    const { error } = await supabase.from("messages").insert({
      group_id: groupId,
      user_id: userId,
      content,
      reply_to_id: replyTo?.id ?? null,
      metadata: mentions.length ? { mentions } : {},
    });
    setSending(false);
    if (!error) {
      setText("");
      setReplyTo(null);
    }
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

  const chatBody = (
    <>
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
            if (item.kind === "system") {
              const challengeId = item.metadata?.challenge_id as string | undefined;
              return (
                <Pressable
                  onPress={() =>
                    challengeId &&
                    router.push({ pathname: "/challenges/[id]", params: { id: challengeId } })
                  }
                  style={[styles.systemPill, { backgroundColor: c.backgroundElement }]}
                >
                  <Text style={{ color: c.brand, fontWeight: "700", fontSize: 13 }}>
                    {item.content} {challengeId ? "→" : ""}
                  </Text>
                </Pressable>
              );
            }
            const mine = item.user_id === userId;
            const parent = item.reply_to_id
              ? messages.find((m) => m.id === item.reply_to_id)
              : undefined;
            return (
              <View style={[styles.msgRow, mine ? styles.mine : styles.theirs]}>
                {!mine ? (
                  <Text style={[styles.author, { color: c.textSecondary }]}>
                    {item.author_name} ·{" "}
                    <Text style={{ fontWeight: "700" }}>
                      {titleForPoints(memberPoints[item.user_id] ?? 0)}
                    </Text>
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
                  {item.reply_to_id ? (
                    <View style={styles.quoteBox}>
                      <Text style={styles.quoteAuthor} numberOfLines={1}>
                        {parent?.author_name ?? "Svar"}
                      </Text>
                      <Text style={styles.quoteContent} numberOfLines={2}>
                        {parent?.content ?? "…"}
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
                    (() => {
                      const poll = polls[item.metadata.poll_id as string];
                      if (!poll) return <ActivityIndicator style={{ margin: 12 }} />;
                      return (
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
                            const pct = poll.total
                              ? Math.round((o.votes / poll.total) * 100)
                              : 0;
                            const isMine = poll.mine === o.id;
                            return (
                              <Pressable
                                key={o.id}
                                onPress={() =>
                                  votePoll(item.metadata.poll_id as string, o.id)
                                }
                                style={[
                                  styles.pollOption,
                                  isMine ? styles.pollOptionMine : null,
                                ]}
                              >
                                <View
                                  style={[styles.pollFill, { width: `${pct}%` }]}
                                />
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
                      );
                    })()
                  ) : (
                    <Text style={{ color: mine ? "#fff" : c.text, fontSize: 15 }}>
                      {item.content}
                    </Text>
                  )}
                </View>
                <View style={styles.reactionRow}>
                  {!mine
                    ? REACTION_ORDER.map((key) => {
                        const entry = reactions[item.id]?.[key];
                        const def = REACTIONS[key];
                        return (
                          <Pressable
                            key={key}
                            onPress={() => toggleReaction(item.id, key)}
                            style={[
                              styles.reactionChip,
                              { backgroundColor: c.backgroundElement },
                              entry?.mine
                                ? { backgroundColor: settings.color, borderColor: settings.color }
                                : null,
                            ]}
                          >
                            <Text style={{ fontSize: 13 }}>
                              {def.emoji}
                              {entry && entry.count > 0 ? ` ${entry.count}` : ""}
                            </Text>
                          </Pressable>
                        );
                      })
                    : null}
                  <Pressable
                    onPress={() => setReplyTo(item)}
                    style={[styles.reactionChip, { backgroundColor: c.backgroundElement }]}
                  >
                    <Text style={{ fontSize: 13, color: c.textSecondary }}>↩︎</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

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
          <Pressable onPress={toggleRecording} style={styles.attachBtn}>
            <Text style={styles.attachEmoji}>{recording ? "⏹" : "🎤"}</Text>
            <Text style={[styles.attachLabel, { color: recording ? "#dc2626" : c.textSecondary }]}>
              {recording ? "Stoppa" : "Röstmemo"}
            </Text>
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
        <View style={styles.recordingBanner}>
          <Text style={styles.recordingText}>🔴 Spelar in röstmemo… tryck ⏹ för att skicka</Text>
        </View>
      ) : null}

      <View style={[styles.inputBar, { borderTopColor: c.backgroundElement }]}>
        <Pressable
          onPress={() => {
            setAttachOpen((v) => !v);
            setEmojiOpen(false);
          }}
          hitSlop={8}
          style={styles.plusBtn}
        >
          <Text style={{ color: settings.color, fontSize: 26, fontWeight: "700" }}>
            {attachOpen ? "×" : "＋"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setEmojiOpen((v) => !v);
            setAttachOpen(false);
          }}
          hitSlop={8}
          style={styles.plusBtn}
        >
          <Text style={{ fontSize: 22 }}>😊</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Skriv ett meddelande…"
          placeholderTextColor={c.textSecondary}
          multiline
          onKeyPress={handleKeyPress}
          style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
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
          <Text style={styles.sendText}>{uploadingMedia ? "Laddar…" : "Skicka"}</Text>
        </Pressable>
      </View>
    </>
  );

  const selectedDuration = group?.beer_duration_minutes ?? BEER_DURATION_OPTIONS[0];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.backgroundElement }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {group?.name ?? ""}
        </Text>
        <Pressable onPress={checkin} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: "#f2a916" }}>
            🔥{streak?.current_streak ?? 0}
          </Text>
        </Pressable>
        <Pressable onPress={() => setGameOpen(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>🎮</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            groupId && router.push({ pathname: "/hunt", params: { groupId } })
          }
          hitSlop={8}
          style={styles.gear}
        >
          <Text style={{ fontSize: 20 }}>🃏</Text>
        </Pressable>
        <Pressable onPress={() => setDuelModalOpen(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>⚔️</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/feed")} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>🏆</Text>
        </Pressable>
        <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} style={styles.gear}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
        <Pressable onPress={invite} hitSlop={8}>
          <Text style={{ color: c.brand, fontWeight: "700" }}>
            {linkCopied ? "Länk kopierad!" : "Bjud in"}
          </Text>
        </Pressable>
      </View>

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

      {powerHourActive ? (
        <View style={styles.powerHourBanner}>
          <Text style={styles.powerHourText}>
            ⚡ POWER HOUR — dubbel XP! {formatCountdown(powerHourRemainingMs)} kvar
          </Text>
        </View>
      ) : null}

      {streak &&
      streak.current_streak > 0 &&
      streak.last_checkin !== new Date().toISOString().slice(0, 10) ? (
        <Pressable onPress={checkin} style={styles.streakWarning}>
          <Text style={styles.streakWarningText}>
            🔥 Din {streak.current_streak}-dagarsstreak ryker om du inte checkar in idag — tryck här!
          </Text>
        </Pressable>
      ) : null}

      {quest ? (
        <View style={[styles.questStrip, { backgroundColor: c.backgroundElement }]}>
          <Text style={[styles.questText, { color: c.text }]} numberOfLines={1}>
            🎯 {quest.title}
          </Text>
          <Pressable
            onPress={completeQuest}
            disabled={questDone}
            style={[
              styles.questBtn,
              { backgroundColor: questDone ? c.backgroundSelected : settings.color },
            ]}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
              {questDone ? "✔ Klar" : `Klar +${quest.bonus}p`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {duel ? (
        <View style={[styles.duelBanner, { backgroundColor: "#7c2d12" }]}>
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

      {activation ? (
        <View style={[styles.activationCard, { backgroundColor: c.brand }]}>
          <View style={styles.activationTop}>
            <Text style={styles.activationTitle} numberOfLines={1}>
              {ACTIVATION_KINDS[activation.kind]?.emoji} {activation.name}
            </Text>
            <Text style={styles.activationTimer}>⏳ {formatRemaining(activationRemainingMs)}</Text>
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
  back: { paddingHorizontal: 4 },
  gear: { paddingHorizontal: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
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
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
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
  audioBubble: { paddingVertical: 2 },
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
