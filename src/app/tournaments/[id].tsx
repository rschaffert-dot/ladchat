import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type {
  Challenge,
  ChallengeStatus,
  Group,
  Tournament,
  TournamentEntry,
} from "@/lib/types";
import { useColors } from "@/lib/ui";

function formatKr(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE")} kr`;
}

const PAYMENT_LABELS: Record<TournamentEntry["payment_status"], string> = {
  pending: "Väntar på betalning",
  paid: "Betald",
  refunded: "Återbetald",
  waived: "Avgiftsfri",
};

const CHALLENGE_STATUS_LABELS: Record<ChallengeStatus, string> = {
  draft: "Ej öppnat",
  open: "Öppet — skicka in bidrag",
  picks_locked: "Bidrag låsta",
  distributed: "Fördelat",
  voting: "Röstning pågår",
  scored: "Poäng klara",
  completed: "Avslutat",
};

type Standing = TournamentEntry & { groupName: string };

export default function TournamentDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const { id: tournamentId } = useLocalSearchParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [myEntries, setMyEntries] = useState<TournamentEntry[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tournamentId || !userId) return;

    const { data: t } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", tournamentId)
      .single();
    setTournament(t as Tournament | null);

    const { data: groups } = await supabase
      .from("groups")
      .select("id,name,owner_id,created_at,beer_glass_size,beer_fill_cl,beer_round_started_at,beer_duration_minutes")
      .order("created_at", { ascending: false });
    setMyGroups((groups ?? []) as Group[]);

    const { data: entries } = await supabase
      .from("tournament_entries")
      .select("*")
      .eq("tournament_id", tournamentId);
    setMyEntries((entries ?? []) as TournamentEntry[]);

    const { data: chals } = await supabase
      .from("challenges")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });
    setChallenges((chals ?? []) as Challenge[]);

    if (entries && entries.length > 0) {
      const groupIds = entries.map((e) => e.group_id);
      const { data: names } = await supabase
        .from("groups")
        .select("id,name")
        .in("id", groupIds);
      const nameMap = new Map((names ?? []).map((g) => [g.id, g.name as string]));
      const rows = (entries as TournamentEntry[])
        .map((e) => ({ ...e, groupName: nameMap.get(e.group_id) ?? "Okänt lag" }))
        .sort((a, b) => b.points - a.points);
      setStandings(rows);
    } else {
      setStandings([]);
    }

    setLoading(false);
  }, [tournamentId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function register(groupId: string) {
    if (!tournamentId) return;
    setRegistering(groupId);
    await supabase.rpc("register_for_tournament", { tid: tournamentId, gid: groupId });
    setRegistering(null);
    void load();
  }

  const entryForGroup = (groupId: string) =>
    myEntries.find((e) => e.group_id === groupId);

  if (loading || !tournament) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {tournament.name}
        </Text>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <View style={styles.content}>
            {tournament.description ? (
              <Text style={[styles.desc, { color: c.textSecondary }]}>
                {tournament.description}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={[styles.meta, { color: c.brand }]}>
                Prispott: {formatKr(tournament.prize_pool_ore)}
              </Text>
              <Text style={[styles.meta, { color: c.textSecondary }]}>
                Insats: {formatKr(tournament.entry_fee_ore)} / lag
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: c.text }]}>Anmäl ditt lag</Text>
            {myGroups.length === 0 ? (
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                Du är inte med i någon grupp än.
              </Text>
            ) : (
              myGroups.map((g) => {
                const entry = entryForGroup(g.id);
                return (
                  <View
                    key={g.id}
                    style={[styles.groupRow, { backgroundColor: c.backgroundElement }]}
                  >
                    <Text style={[styles.groupName, { color: c.text }]}>{g.name}</Text>
                    {entry ? (
                      <Text
                        style={[
                          styles.paymentTag,
                          {
                            color: entry.payment_status === "paid" ? c.brand : c.textSecondary,
                          },
                        ]}
                      >
                        {PAYMENT_LABELS[entry.payment_status]}
                      </Text>
                    ) : (
                      <Pressable
                        onPress={() => register(g.id)}
                        disabled={registering === g.id}
                        style={[styles.registerBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.registerText}>
                          {registering === g.id ? "Anmäler…" : "Anmäl"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionTitle, { color: c.text }]}>Uppdrag</Text>
            {challenges.length === 0 ? (
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                Inga uppdrag har öppnats än.
              </Text>
            ) : (
              challenges.map((ch) => (
                <Pressable
                  key={ch.id}
                  onPress={() =>
                    router.push({ pathname: "/challenges/[id]", params: { id: ch.id } })
                  }
                  style={[styles.groupRow, { backgroundColor: c.backgroundElement }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.groupName, { color: c.text }]}>{ch.title}</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                      {CHALLENGE_STATUS_LABELS[ch.status]}
                    </Text>
                  </View>
                  <Text style={{ color: c.textSecondary }}>›</Text>
                </Pressable>
              ))
            )}

            <Text style={[styles.sectionTitle, { color: c.text }]}>Topplista</Text>
            {standings.length === 0 ? (
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                Inga anmälda lag än.
              </Text>
            ) : (
              standings.map((s, i) => (
                <View
                  key={s.id}
                  style={[styles.standingRow, { borderBottomColor: c.backgroundSelected }]}
                >
                  <Text style={{ color: c.textSecondary, width: 24 }}>{i + 1}.</Text>
                  <Text style={[styles.groupName, { color: c.text, flex: 1 }]}>
                    {s.groupName}
                  </Text>
                  <Text style={[styles.points, { color: c.brand }]}>{s.points}p</Text>
                </View>
              ))
            )}
          </View>
        }
      />
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
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
  desc: { fontSize: 14, marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 16, marginBottom: 8 },
  meta: { fontSize: 14, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginTop: 20, marginBottom: 8 },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  groupName: { fontSize: 15, fontWeight: "600" },
  paymentTag: { fontSize: 12, fontWeight: "700" },
  registerBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  registerText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  points: { fontSize: 15, fontWeight: "800" },
});
