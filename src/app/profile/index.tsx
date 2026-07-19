import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { avatarUrl, uploadAvatar } from "@/lib/avatar";
import { getChatMediaUrl } from "@/lib/chatMedia";
import { progressForPoints, titleForPoints } from "@/lib/gamification";
import {
  CATEGORIES,
  HUNT_SERIF,
  isVideoPath,
  TIERS,
} from "@/lib/huntCards";
import type { HuntChallenge, HuntCompletion } from "@/lib/huntCards";
import { supabase } from "@/lib/supabase";
import type { Achievement, Streak, UserAchievement } from "@/lib/types";
import { useColors } from "@/lib/ui";

/** Ett uppslag i LadBook: klarad utmaning + dess bevismaterial. */
type LadBookEntry = {
  completion: HuntCompletion;
  challenge: HuntChallenge;
  proofUrl: string | null;
  proofIsVideo: boolean;
};

type GroupStat = { groupId: string; groupName: string; points: number };

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [stats, setStats] = useState<GroupStat[]>([]);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<UserAchievement[]>([]);
  const [ladbook, setLadbook] = useState<LadBookEntry[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: prof }, { data: memberships }, { data: st }, { data: all }, { data: mine }] =
      await Promise.all([
        supabase.from("profiles").select("display_name,email,avatar_path").eq("id", userId).single(),
        supabase
          .from("group_members")
          .select("group_id, points, groups(name)")
          .eq("user_id", userId),
        supabase.from("streaks").select("*").eq("user_id", userId),
        supabase.from("achievements").select("*").order("code"),
        supabase.from("user_achievements").select("*").eq("user_id", userId),
      ]);
    setName(prof?.display_name || prof?.email || "");
    setAvatar(avatarUrl(prof?.avatar_path));
    // Supabase typar joinen som en array trots att den är en till-1-relation.
    setStats(
      (
        (memberships ?? []) as unknown as {
          group_id: string;
          points: number;
          groups: { name: string } | { name: string }[] | null;
        }[]
      )
        .map((m) => ({
          groupId: m.group_id,
          groupName:
            (Array.isArray(m.groups) ? m.groups[0]?.name : m.groups?.name) ?? "Grupp",
          points: m.points,
        }))
        .sort((a, b) => b.points - a.points),
    );
    setStreaks((st ?? []) as Streak[]);
    setCatalog((all ?? []) as Achievement[]);
    setEarned((mine ?? []) as UserAchievement[]);

    // LadBook: klarade (och väntande) jaktutmaningar med bevismaterial.
    const { data: comps } = await supabase
      .from("hunt_completions")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["confirmed", "pending"])
      .order("created_at", { ascending: false });
    const completions = (comps ?? []) as HuntCompletion[];
    if (completions.length === 0) {
      setLadbook([]);
      return;
    }
    const { data: chs } = await supabase
      .from("hunt_challenges")
      .select("*")
      .in("id", completions.map((c) => c.challenge_id));
    const chMap = new Map(((chs ?? []) as HuntChallenge[]).map((c) => [c.id, c]));
    setLadbook(
      await Promise.all(
        completions
          .filter((c) => chMap.has(c.challenge_id))
          .map(async (c) => ({
            completion: c,
            challenge: chMap.get(c.challenge_id)!,
            proofUrl: c.proof_url ? await getChatMediaUrl(c.proof_url) : null,
            proofIsVideo: c.proof_url ? isVideoPath(c.proof_url) : false,
          })),
      ),
    );
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeAvatar() {
    if (!userId || avatarBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    setAvatarBusy(true);
    try {
      const url = await uploadAvatar(userId, result.assets[0].uri, result.assets[0].mimeType ?? "image/jpeg");
      setAvatar(url);
    } finally {
      setAvatarBusy(false);
    }
  }

  const bestStreak = streaks.reduce((m, s) => Math.max(m, s.current_streak), 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.backgroundElement }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Min profil</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarRow}>
          <Pressable
            onPress={changeAvatar}
            disabled={avatarBusy}
            style={[
              styles.avatar,
              { backgroundColor: c.backgroundElement, borderColor: c.backgroundSelected },
            ]}
          >
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImg} />
            ) : (
              <Text style={{ fontSize: 32 }}>👤</Text>
            )}
          </Pressable>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: c.text }]}>{name}</Text>
            <Pressable onPress={changeAvatar} disabled={avatarBusy} hitSlop={6}>
              <Text style={{ color: c.brand, fontWeight: "600", fontSize: 13 }}>
                {avatarBusy ? "Laddar upp…" : avatar ? "Byt bild" : "Lägg till bild"}
              </Text>
            </Pressable>
          </View>
        </View>
        {bestStreak > 0 ? (
          <Text style={{ color: c.textSecondary, fontSize: 13 }}>
            🔥 Längsta aktiva streak: {bestStreak} dagar
          </Text>
        ) : null}

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Level per grupp</Text>
        {stats.map((s) => {
          const { current, next, progress } = progressForPoints(s.points);
          return (
            <View key={s.groupId} style={[styles.card, { backgroundColor: c.backgroundElement }]}>
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {s.groupName}
                </Text>
                <Text style={{ color: c.brand, fontWeight: "800", fontSize: 13 }}>
                  Lv {current.level} · {titleForPoints(s.points)}
                </Text>
              </View>
              <View style={[styles.xpTrack, { backgroundColor: c.backgroundSelected }]}>
                <View
                  style={[styles.xpFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.brand }]}
                />
              </View>
              <Text style={{ color: c.textSecondary, fontSize: 11 }}>
                {s.points} XP
                {next ? ` — ${next.min - s.points} kvar till ${next.title}` : " — maxad, Legend!"}
              </Text>
            </View>
          );
        })}
        {stats.length === 0 ? (
          <Text style={{ color: c.textSecondary, fontSize: 13 }}>
            Gå med i en grupp för att börja samla XP.
          </Text>
        ) : null}

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
          Trophy-skåp ({earned.length}/{catalog.length})
        </Text>
        <View style={styles.trophyGrid}>
          {catalog.map((a) => {
            const has = earned.some((e) => e.code === a.code);
            return (
              <View
                key={a.code}
                style={[
                  styles.trophy,
                  { backgroundColor: c.backgroundElement, opacity: has ? 1 : 0.35 },
                ]}
              >
                <Text style={{ fontSize: 30 }}>{has ? a.emoji : "🔒"}</Text>
                <Text style={[styles.trophyName, { color: c.text }]} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={[styles.trophyDesc, { color: c.textSecondary }]} numberOfLines={2}>
                  {a.description}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
          🃏 LadBook ({ladbook.filter((e) => e.completion.status === "confirmed").length} klarade)
        </Text>
        {ladbook.length === 0 ? (
          <Pressable onPress={() => router.push("/hunt")}>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              Inga kort insamlade än — ge dig ut på{" "}
              <Text style={{ color: c.brand, fontWeight: "700" }}>Poängjakten</Text> och samla
              din första bragd!
            </Text>
          </Pressable>
        ) : (
          ladbook.map(({ completion, challenge, proofUrl, proofIsVideo }) => {
            const t = TIERS[challenge.tier];
            return (
              <View key={completion.id} style={styles.ladbookRow}>
                {/* Utmaningskortet */}
                <Pressable
                  onPress={() => router.push("/hunt")}
                  style={[styles.ladCard, { borderColor: t.frame, backgroundColor: t.face }]}
                >
                  <View style={[styles.ladCardInner, { borderColor: t.frameDark }]}>
                    <Text style={styles.ladCorner}>{t.symbol}</Text>
                    <Text style={styles.ladCornerRight}>
                      {CATEGORIES[challenge.category]?.emoji}
                    </Text>
                    <Text style={[styles.ladCardName, { color: t.text }]} numberOfLines={3}>
                      {challenge.name.toUpperCase()}
                    </Text>
                    <Text style={[styles.ladCardMeta, { color: t.frameDark }]}>
                      {t.label} · {completion.status === "confirmed"
                        ? `+${completion.points_awarded}p`
                        : `${challenge.points}p`}
                    </Text>
                    {completion.status === "pending" ? (
                      <Text style={styles.ladPending}>⏳ väntar på vittne</Text>
                    ) : null}
                  </View>
                </Pressable>

                {/* Beviskortet */}
                <Pressable
                  onPress={() => proofUrl && Linking.openURL(proofUrl)}
                  disabled={!proofUrl}
                  style={[styles.ladCard, { borderColor: t.frame, backgroundColor: "#14100d" }]}
                >
                  <View style={[styles.ladCardInner, { borderColor: t.frameDark, padding: 0 }]}>
                    {proofUrl && !proofIsVideo ? (
                      <Image source={{ uri: proofUrl }} style={styles.ladProofImg} />
                    ) : (
                      <View style={styles.ladProofEmpty}>
                        <Text style={{ fontSize: 30 }}>{proofUrl ? "🎬" : "🕳"}</Text>
                        <Text style={styles.ladProofEmptyText}>
                          {proofUrl ? "Visa videobevis" : "Bevis saknas"}
                        </Text>
                      </View>
                    )}
                    <View style={styles.ladProofBadge}>
                      <Text style={styles.ladProofBadgeText}>BEVIS</Text>
                    </View>
                  </View>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  flex: { flex: 1 },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  name: { fontSize: 22, fontWeight: "800" },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 4 },
  card: { borderRadius: 14, padding: 14, gap: 8, marginBottom: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  xpTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  xpFill: { height: 8, borderRadius: 4 },
  trophyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  trophy: {
    width: "47%",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  trophyName: { fontSize: 13, fontWeight: "700" },
  trophyDesc: { fontSize: 11, textAlign: "center" },
  ladbookRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  ladCard: {
    flex: 1,
    aspectRatio: 0.68,
    borderRadius: 12,
    borderWidth: 3,
    padding: 4,
    overflow: "hidden",
  },
  ladCardInner: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    gap: 6,
    overflow: "hidden",
  },
  ladCorner: { position: "absolute", top: 4, left: 6, fontSize: 13 },
  ladCornerRight: { position: "absolute", top: 4, right: 6, fontSize: 12 },
  ladCardName: {
    fontFamily: HUNT_SERIF,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  ladCardMeta: { fontSize: 11, fontWeight: "700", position: "absolute", bottom: 6 },
  ladPending: { fontSize: 11, color: "#7c4a1e", fontWeight: "600" },
  ladProofImg: { width: "100%", height: "100%" },
  ladProofEmpty: { alignItems: "center", gap: 6 },
  ladProofEmptyText: { color: "#b9a97f", fontSize: 12, fontWeight: "600" },
  ladProofBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ladProofBadgeText: { color: "#e9dcb8", fontWeight: "900", fontSize: 10, letterSpacing: 2 },
});
