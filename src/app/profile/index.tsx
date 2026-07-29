import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
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
import { achievementIcon } from "@/lib/achievements";
import { supabase } from "@/lib/supabase";
import type { Achievement, Streak, UserAchievement } from "@/lib/types";
import { AppIcon } from "@/components/AppIcon";
import { Icon } from "@/components/Icon";
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
  const [rivals, setRivals] = useState<{ name: string; wins: number; losses: number }[]>([]);
  const [ladbookOpen, setLadbookOpen] = useState(true);
  const [expanded, setExpanded] = useState<LadBookEntry | null>(null);

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

    // Rivaler: vinst/förlust per motståndare ur avgjorda dueller.
    const { data: myDuels } = await supabase
      .from("duels")
      .select("challenger_id, opponent_id, winner_id")
      .eq("status", "finished")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`);
    const tally = new Map<string, { wins: number; losses: number }>();
    for (const d of myDuels ?? []) {
      const opp = (d.challenger_id === userId ? d.opponent_id : d.challenger_id) as string;
      if (!d.winner_id) continue;
      const t = tally.get(opp) ?? { wins: 0, losses: 0 };
      if (d.winner_id === userId) t.wins++;
      else t.losses++;
      tally.set(opp, t);
    }
    if (tally.size > 0) {
      const { data: oppProfs } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", [...tally.keys()]);
      setRivals(
        [...tally.entries()]
          .map(([id, t]) => ({
            name:
              ((oppProfs ?? []).find((p) => p.id === id)?.display_name as string) ||
              ((oppProfs ?? []).find((p) => p.id === id)?.email as string) ||
              "Okänd",
            ...t,
          }))
          .sort((a, b) => b.wins + b.losses - (a.wins + a.losses))
          .slice(0, 3),
      );
    } else {
      setRivals([]);
    }

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
          <Icon name="chevron-left" size={26} color={c.textSecondary} />
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
              <Icon name="user" size={30} color={c.textSecondary} />
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
          <View style={styles.inlineRow}>
            <AppIcon name="fire" size={14} color={c.textSecondary} />
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              Längsta aktiva streak: {bestStreak} dagar
            </Text>
          </View>
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
                <AppIcon
                  name={has ? achievementIcon(a.code) : "lock"}
                  size={26}
                  color={has ? c.brand : c.textSecondary}
                />
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

        {rivals.length > 0 ? (
          <>
            <View style={[styles.inlineRow, { marginTop: 18 }]}>
              <AppIcon name="swords" size={15} color={c.textSecondary} />
              <Text style={[styles.sectionTitle, { color: c.textSecondary, marginTop: 0 }]}>
                Rivaler{" "}
                {rivals[0] ? (
                  <Text style={{ color: c.brand }}>— din ärkerival: {rivals[0].name}</Text>
                ) : null}
              </Text>
            </View>
            {rivals.map((r) => (
              <View
                key={r.name}
                style={[
                  styles.card,
                  { backgroundColor: c.backgroundElement, flexDirection: "row", gap: 8 },
                ]}
              >
                <Text style={{ color: c.text, fontSize: 14, fontWeight: "700", flex: 1 }}>
                  vs {r.name}
                </Text>
                <Text style={{ color: r.wins >= r.losses ? "#16a34a" : "#FF4C29", fontWeight: "800" }}>
                  {r.wins}–{r.losses}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <Pressable onPress={() => setLadbookOpen((v) => !v)} style={styles.ladHeader}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary, marginTop: 0, marginBottom: 0 }]}>
            LadBook ({ladbook.filter((e) => e.completion.status === "confirmed").length} klarade)
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Pressable onPress={() => router.push("/hunt")} hitSlop={6}>
              <Text style={{ color: c.brand, fontWeight: "700", fontSize: 13 }}>
                Poängjakten ›
              </Text>
            </Pressable>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              {ladbookOpen ? "▾" : "▸"}
            </Text>
          </View>
        </Pressable>
        {!ladbookOpen ? null : ladbook.length === 0 ? (
          <Pressable onPress={() => router.push("/hunt")}>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              Inga kort insamlade än — ge dig ut på{" "}
              <Text style={{ color: c.brand, fontWeight: "700" }}>Poängjakten</Text> och samla
              din första bragd!
            </Text>
          </Pressable>
        ) : (
          <View style={styles.ladGrid}>
            {ladbook.map((entry) => {
              const { completion, challenge, proofUrl, proofIsVideo } = entry;
              const t = TIERS[challenge.tier];
              return (
                <Pressable
                  key={completion.id}
                  onPress={() => setExpanded(entry)}
                  style={[styles.ladMini, { borderColor: t.frame, backgroundColor: t.face }]}
                >
                  {proofUrl && !proofIsVideo ? (
                    <Image source={{ uri: proofUrl }} style={styles.ladMiniImg} />
                  ) : (
                    <AppIcon name={proofUrl ? "film" : t.icon} size={16} color={t.frameDark} />
                  )}
                  <Text style={[styles.ladMiniName, { color: t.text }]} numberOfLines={1}>
                    {challenge.name}
                  </Text>
                  {completion.status === "pending" ? (
                    <View style={styles.ladMiniBadge}>
                      <AppIcon name="hourglass" size={11} color={t.frameDark} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Uppslaget kortpar: utmaningskortet + beviset i full storlek */}
      <Modal
        visible={!!expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setExpanded(null)}
      >
        <View style={styles.ladModalDim}>
          <ScrollView contentContainerStyle={styles.ladModalScroll}>
            {expanded ? (() => {
              const { completion, challenge, proofUrl, proofIsVideo } = expanded;
              const t = TIERS[challenge.tier];
              return (
                <>
                  <View style={[styles.ladBigCard, { borderColor: t.frame, backgroundColor: t.face }]}>
                    <View style={[styles.ladBigInner, { borderColor: t.frameDark }]}>
                      <View style={styles.ladBigTop}>
                        <AppIcon name={t.icon} size={20} color={t.frameDark} />
                        <Text style={[styles.ladBigTier, { color: t.frameDark }]}>{t.label}</Text>
                        <AppIcon
                          name={CATEGORIES[challenge.category]?.icon ?? "star"}
                          size={20}
                          color={t.frameDark}
                        />
                      </View>
                      <Text style={[styles.ladBigName, { color: t.text }]}>
                        {challenge.name.toUpperCase()}
                      </Text>
                      <Text style={[styles.ladBigOrnament, { color: t.frame }]}>✦ ─────── ✦</Text>
                      <Text style={[styles.ladBigDesc, { color: t.text }]}>
                        {challenge.description}
                      </Text>
                      <View style={styles.ladBigPointsRow}>
                        <AppIcon
                          name={completion.status === "confirmed" ? "star" : "hourglass"}
                          size={14}
                          color={t.text}
                        />
                        <Text style={[styles.ladBigPoints, { color: t.text }]}>
                          {completion.status === "confirmed"
                            ? `Klarad — +${completion.points_awarded}p`
                            : `Väntar på vittnets bekräftelse (${challenge.points}p)`}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => proofUrl && Linking.openURL(proofUrl)}
                    disabled={!proofUrl}
                    style={[styles.ladBigCard, { borderColor: t.frame, backgroundColor: "#15151B" }]}
                  >
                    <View style={[styles.ladBigInner, { borderColor: t.frameDark, padding: 0, overflow: "hidden" }]}>
                      {proofUrl && !proofIsVideo ? (
                        <Image source={{ uri: proofUrl }} style={styles.ladBigProofImg} />
                      ) : (
                        <View style={styles.ladProofEmpty}>
                          <AppIcon
                            name={proofUrl ? "film" : "hole"}
                            size={38}
                            color="#84828C"
                            strokeWidth={1.4}
                          />
                          <Text style={styles.ladProofEmptyText}>
                            {proofUrl ? "Tryck för att visa videobeviset" : "Bevis saknas"}
                          </Text>
                        </View>
                      )}
                      <View style={styles.ladProofBadge}>
                        <Text style={styles.ladProofBadgeText}>BEVIS</Text>
                      </View>
                    </View>
                  </Pressable>

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {completion.status === "confirmed" ? (
                      <Pressable
                        onPress={() =>
                          void Share.share({
                            message: `Jag klarade "${challenge.name}" i Poängjakten på LadChat — +${completion.points_awarded}p! Vågar du?`,
                          })
                        }
                        style={[styles.ladCloseBtn, { backgroundColor: "#3D5AFE", flexDirection: "row", gap: 6 }]}
                      >
                        <Icon name="share-2" size={15} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "800" }}>Dela</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => setExpanded(null)} style={styles.ladCloseBtn}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>Stäng</Text>
                    </Pressable>
                  </View>
                </>
              );
            })() : null}
          </ScrollView>
        </View>
      </Modal>
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
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  name: { fontSize: 22, fontWeight: "800" },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 4 },
  card: { borderRadius: 8, padding: 14, gap: 8, marginBottom: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  xpTrack: { height: 8, borderRadius: 8, overflow: "hidden" },
  xpFill: { height: 8, borderRadius: 8 },
  trophyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  trophy: {
    width: "47%",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  trophyName: { fontSize: 13, fontWeight: "700" },
  trophyDesc: { fontSize: 11, textAlign: "center" },
  ladHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 6,
  },
  ladGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ladMini: {
    width: 64,
    aspectRatio: 0.68,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
    gap: 3,
    overflow: "hidden",
  },
  ladMiniImg: { width: "100%", flex: 1, borderRadius: 8 },
  ladMiniName: { fontFamily: HUNT_SERIF, fontSize: 8, fontWeight: "700", textAlign: "center" },
  ladMiniBadge: { position: "absolute", top: 3, right: 4 },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  ladModalDim: { flex: 1, backgroundColor: "rgba(21,21,27,0.88)" },
  ladModalScroll: {
    padding: 20,
    paddingTop: 48,
    alignItems: "center",
    gap: 14,
    paddingBottom: 60,
  },
  ladBigCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 8,
    borderWidth: 4,
    padding: 6,
    overflow: "hidden",
  },
  ladBigInner: { borderWidth: 1.5, borderRadius: 8, padding: 14, gap: 8 },
  ladBigTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ladBigTier: { fontFamily: HUNT_SERIF, fontSize: 13, fontWeight: "700", letterSpacing: 3 },
  ladBigName: {
    fontFamily: HUNT_SERIF,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 1,
  },
  ladBigOrnament: { textAlign: "center", fontSize: 11 },
  ladBigDesc: { fontFamily: HUNT_SERIF, fontSize: 15, lineHeight: 21, textAlign: "center" },
  ladBigPoints: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  ladBigPointsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  ladBigProofImg: { width: "100%", aspectRatio: 0.75 },
  ladProofEmpty: { alignItems: "center", gap: 6, paddingVertical: 40 },
  ladProofEmptyText: { color: "#84828C", fontSize: 12, fontWeight: "600" },
  ladProofBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ladProofBadgeText: { color: "#F5F4F0", fontWeight: "900", fontSize: 10, letterSpacing: 2 },
  ladCloseBtn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
});
