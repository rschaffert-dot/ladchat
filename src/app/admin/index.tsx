import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import type { Challenge, Tournament, TournamentEntry } from "@/lib/types";
import { useColors } from "@/lib/ui";
import { useIsAdmin } from "@/lib/useIsAdmin";

const TOURNAMENT_STATUS_LABEL: Record<Tournament["status"], string> = {
  draft: "Utkast",
  registration_open: "Anmälan öppen",
  active: "Pågår",
  completed: "Avslutad",
};

// Uppdrag som fortfarande kräver handpåläggning av tävlingsledningen.
const ACTIVE_CHALLENGE_STATUSES: Challenge["status"][] = [
  "draft",
  "open",
  "picks_locked",
  "distributed",
  "voting",
];

type TournamentOverview = {
  tournament: Tournament;
  entryCount: number;
  paidCount: number;
  pendingCount: number;
  challengeCount: number;
  activeChallengeCount: number;
};

export default function AdminHomeScreen() {
  const c = useColors();
  const router = useRouter();
  const isAdmin = useIsAdmin();

  const [rows, setRows] = useState<TournamentOverview[]>([]);
  const [loading, setLoading] = useState(true);

  // Faller tillbaka till grupplistan om det inte finns någon historik att gå tillbaka
  // till (t.ex. direktlänk eller webbladdning) — annars gör GO_BACK ingenting.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/groups");
  }, [router]);

  const load = useCallback(async () => {
    const [{ data: ts }, { data: entries }, { data: challenges }] = await Promise.all([
      supabase.from("tournaments").select("*").order("created_at", { ascending: false }),
      supabase.from("tournament_entries").select("tournament_id,payment_status"),
      supabase.from("challenges").select("tournament_id,status"),
    ]);

    const entryRows = (entries ?? []) as Pick<TournamentEntry, "tournament_id" | "payment_status">[];
    const challengeRows = (challenges ?? []) as Pick<Challenge, "tournament_id" | "status">[];

    const overview = ((ts ?? []) as Tournament[]).map((tournament) => {
      const tEntries = entryRows.filter((e) => e.tournament_id === tournament.id);
      const tChallenges = challengeRows.filter((ch) => ch.tournament_id === tournament.id);
      return {
        tournament,
        entryCount: tEntries.length,
        paidCount: tEntries.filter((e) => e.payment_status === "paid").length,
        pendingCount: tEntries.filter((e) => e.payment_status === "pending").length,
        challengeCount: tChallenges.length,
        activeChallengeCount: tChallenges.filter((ch) =>
          ACTIVE_CHALLENGE_STATUSES.includes(ch.status),
        ).length,
      };
    });
    setRows(overview);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      tournaments: acc.tournaments + 1,
      pending: acc.pending + r.pendingCount,
      activeChallenges: acc.activeChallenges + r.activeChallengeCount,
    }),
    { tournaments: 0, pending: 0, activeChallenges: 0 },
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
        <View style={styles.header}>
          <Pressable onPress={goBack} hitSlop={8} style={styles.back}>
            <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
          </Pressable>
        </View>
        <Text style={{ color: c.textSecondary, textAlign: "center", marginTop: 40 }}>
          Endast för tävlingsledning.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Tävlingsledning</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: c.backgroundElement }]}>
              <Text style={[styles.statNumber, { color: c.text }]}>{totals.tournaments}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Turneringar</Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: totals.pending > 0 ? c.brand : c.backgroundElement },
              ]}
            >
              <Text style={[styles.statNumber, { color: totals.pending > 0 ? "#fff" : c.text }]}>
                {totals.pending}
              </Text>
              <Text
                style={[
                  styles.statLabel,
                  { color: totals.pending > 0 ? "#fff" : c.textSecondary },
                ]}
              >
                Väntar på betalning
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.backgroundElement }]}>
              <Text style={[styles.statNumber, { color: c.text }]}>{totals.activeChallenges}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Aktiva uppdrag</Text>
            </View>
          </View>

          <Pressable
            onPress={() => router.push("/admin/manage")}
            style={[styles.manageBtn, { backgroundColor: c.brand }]}
          >
            <Text style={styles.manageBtnText}>+ Skapa & hantera turneringar</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/activations")}
            style={[styles.secondaryBtn, { borderColor: c.backgroundSelected }]}
          >
            <Text style={[styles.secondaryBtnText, { color: c.text }]}>
              💤 Aktivera chattar
            </Text>
          </Pressable>

          <Text style={[styles.sectionTitle, { color: c.text }]}>Översikt</Text>
          {rows.length === 0 ? (
            <Text style={{ color: c.textSecondary, marginTop: 8 }}>
              Inga turneringar än. Skapa en via knappen ovan.
            </Text>
          ) : (
            rows.map(({ tournament, entryCount, paidCount, pendingCount, challengeCount, activeChallengeCount }) => (
              <Pressable
                key={tournament.id}
                onPress={() => router.push("/admin/manage")}
                style={[styles.card, { backgroundColor: c.backgroundElement }]}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                    {tournament.name}
                  </Text>
                  <View style={[styles.badge, { borderColor: c.backgroundSelected }]}>
                    <Text style={[styles.badgeText, { color: c.textSecondary }]}>
                      {TOURNAMENT_STATUS_LABEL[tournament.status]}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
                  {entryCount} anmälda · {paidCount} betalda
                  {pendingCount > 0 ? ` · ${pendingCount} väntar` : ""}
                </Text>
                <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
                  {challengeCount} uppdrag{activeChallengeCount > 0 ? ` · ${activeChallengeCount} aktiva` : ""}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
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
  title: { fontSize: 18, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 4,
  },
  statNumber: { fontSize: 26, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "600", textAlign: "center" },
  manageBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginBottom: 8 },
  manageBtnText: { color: "#fff", fontWeight: "700" },
  secondaryBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 8,
  },
  secondaryBtnText: { fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginTop: 16, marginBottom: 4 },
  card: { borderRadius: 16, padding: 16, marginTop: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "800" },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  cardMeta: { fontSize: 13, marginTop: 2 },
});
