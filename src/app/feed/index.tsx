import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import type { Tournament, TournamentEntry } from "@/lib/types";
import { useColors } from "@/lib/ui";

function formatKr(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE")} kr`;
}

const STATUS_LABELS: Record<Tournament["status"], string> = {
  draft: "Ej öppnad",
  registration_open: "Anmälan öppen",
  active: "Pågår",
  completed: "Avslutad",
};

// Ordning i feeden: pågående och öppna turneringar först, avslutade sist.
const STATUS_ORDER: Record<Tournament["status"], number> = {
  active: 0,
  registration_open: 1,
  draft: 2,
  completed: 3,
};

const MEDALS = ["🥇", "🥈", "🥉"];

type Tab = "tournaments" | "leaderboard";

type LeaderboardRow = {
  groupId: string;
  groupName: string;
  points: number;
  tournaments: number;
  achievements: string[];
};

export default function FeedScreen() {
  const c = useColors();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("tournaments");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/groups");
  }, [router]);

  const load = useCallback(async () => {
    const [{ data: ts }, { data: entries }, { data: groups }, { data: catalog }, { data: groupAch }] =
      await Promise.all([
        supabase.from("tournaments").select("*").order("created_at", { ascending: false }),
        supabase.from("tournament_entries").select("group_id,points"),
        supabase.from("groups").select("id,name"),
        supabase.from("achievements").select("code,emoji"),
        // Gruppens badges (bara group_id + code, aldrig vem) — deltagarnamn skyddas.
        supabase.rpc("public_group_achievements"),
      ]);

    const sorted = ((ts ?? []) as Tournament[]).sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    );
    setTournaments(sorted);

    // code → emoji, samt group_id → emoji-lista för gruppens achievements.
    const emojiFor = new Map(
      ((catalog ?? []) as { code: string; emoji: string }[]).map((a) => [a.code, a.emoji]),
    );
    const achByGroup = new Map<string, string[]>();
    for (const r of (groupAch ?? []) as { group_id: string; code: string }[]) {
      const emoji = emojiFor.get(r.code);
      if (!emoji) continue;
      const list = achByGroup.get(r.group_id) ?? [];
      list.push(emoji);
      achByGroup.set(r.group_id, list);
    }

    // Aggregera lagpoäng över samtliga turneringar till en global topplista.
    const nameMap = new Map((groups ?? []).map((g) => [g.id as string, g.name as string]));
    const agg = new Map<string, LeaderboardRow>();
    for (const e of (entries ?? []) as Pick<TournamentEntry, "group_id" | "points">[]) {
      const prev = agg.get(e.group_id);
      if (prev) {
        prev.points += e.points;
        prev.tournaments += 1;
      } else {
        agg.set(e.group_id, {
          groupId: e.group_id,
          groupName: nameMap.get(e.group_id) ?? "Okänt lag",
          points: e.points,
          tournaments: 1,
          achievements: achByGroup.get(e.group_id) ?? [],
        });
      }
    }
    const board = [...agg.values()]
      .sort((a, b) => b.points - a.points)
      .slice(0, 50);
    setLeaderboard(board);

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Utforska</Text>
      </View>

      <View style={styles.tabs}>
        {(["tournaments", "leaderboard"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tab,
                { borderColor: c.backgroundSelected },
                active ? { backgroundColor: c.brand, borderColor: c.brand } : null,
              ]}
            >
              <Text style={[styles.tabText, { color: active ? "#fff" : c.text }]}>
                {t === "tournaments" ? "Turneringar" : "Topplista"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : tab === "tournaments" ? (
        <FlatList
          data={tournaments}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              Inga turneringar ännu.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/tournaments/[id]", params: { id: item.id } })
              }
              style={[styles.card, { backgroundColor: c.backgroundElement }]}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={[styles.badge, { borderColor: c.backgroundSelected }]}>
                  <Text style={[styles.badgeText, { color: c.textSecondary }]}>
                    {STATUS_LABELS[item.status]}
                  </Text>
                </View>
              </View>
              {item.description ? (
                <Text style={[styles.cardDesc, { color: c.textSecondary }]} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <View style={styles.cardRow}>
                <Text style={[styles.cardMeta, { color: c.brand }]}>
                  Prispott: {formatKr(item.prize_pool_ore)}
                </Text>
                <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
                  Insats: {formatKr(item.entry_fee_ore)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={leaderboard}
          keyExtractor={(r) => r.groupId}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={[styles.boardHint, { color: c.textSecondary }]}>
              Totala poäng över alla turneringar
            </Text>
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              Inga poäng utdelade ännu.
            </Text>
          }
          renderItem={({ item, index }) => (
            <View style={[styles.boardRow, { backgroundColor: c.backgroundElement }]}>
              <Text style={[styles.rank, { color: c.textSecondary }]}>
                {MEDALS[index] ?? `${index + 1}`}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.boardName, { color: c.text }]} numberOfLines={1}>
                  {item.groupName}
                </Text>
                <Text style={[styles.boardMeta, { color: c.textSecondary }]}>
                  {item.tournaments} {item.tournaments === 1 ? "turnering" : "turneringar"}
                </Text>
                {item.achievements.length > 0 ? (
                  <Text style={styles.boardBadges} numberOfLines={1}>
                    {item.achievements.join(" ")}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.points, { color: c.brand }]}>{item.points}p</Text>
            </View>
          )}
        />
      )}
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
    paddingVertical: 12,
  },
  back: { paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabText: { fontSize: 14, fontWeight: "700" },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 10, paddingBottom: 24 },
  empty: { textAlign: "center", marginTop: 40 },
  card: { borderRadius: 16, padding: 16, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  cardDesc: { fontSize: 13 },
  cardRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  cardMeta: { fontSize: 13, fontWeight: "600" },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  boardHint: { fontSize: 13, marginBottom: 4 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rank: { width: 28, fontSize: 17, fontWeight: "800", textAlign: "center" },
  boardName: { fontSize: 15, fontWeight: "700" },
  boardMeta: { fontSize: 12, marginTop: 1 },
  boardBadges: { fontSize: 15, marginTop: 3 },
  points: { fontSize: 17, fontWeight: "800" },
});
