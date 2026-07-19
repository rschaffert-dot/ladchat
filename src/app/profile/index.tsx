import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { progressForPoints, titleForPoints } from "@/lib/gamification";
import { supabase } from "@/lib/supabase";
import type { Achievement, Streak, UserAchievement } from "@/lib/types";
import { useColors } from "@/lib/ui";

type GroupStat = { groupId: string; groupName: string; points: number };

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();

  const [name, setName] = useState("");
  const [stats, setStats] = useState<GroupStat[]>([]);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [earned, setEarned] = useState<UserAchievement[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: prof }, { data: memberships }, { data: st }, { data: all }, { data: mine }] =
      await Promise.all([
        supabase.from("profiles").select("display_name,email").eq("id", userId).single(),
        supabase
          .from("group_members")
          .select("group_id, points, groups(name)")
          .eq("user_id", userId),
        supabase.from("streaks").select("*").eq("user_id", userId),
        supabase.from("achievements").select("*").order("code"),
        supabase.from("user_achievements").select("*").eq("user_id", userId),
      ]);
    setName(prof?.display_name || prof?.email || "");
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
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <Text style={[styles.name, { color: c.text }]}>{name}</Text>
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
});
