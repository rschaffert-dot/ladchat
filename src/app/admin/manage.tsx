import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import type { Challenge, Tournament, TournamentEntry } from "@/lib/types";
import { useColors } from "@/lib/ui";
import { useIsAdmin } from "@/lib/useIsAdmin";

type EntryRow = TournamentEntry & { groupName: string };

export default function AdminScreen() {
  const c = useColors();
  const router = useRouter();
  const isAdmin = useIsAdmin();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [entriesByTournament, setEntriesByTournament] = useState<Record<string, EntryRow[]>>({});
  const [challengesByTournament, setChallengesByTournament] = useState<Record<string, Challenge[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Faller tillbaka till admin-hemskärmen om historiken är tom (t.ex. direktlänk).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  }, [router]);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFeeKr, setNewFeeKr] = useState("100");
  const [newPrizeKr, setNewPrizeKr] = useState("1000000");

  const [newChallengeTitle, setNewChallengeTitle] = useState<Record<string, string>>({});
  const [newChallengeDesc, setNewChallengeDesc] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data: ts } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    const tournamentRows = (ts ?? []) as Tournament[];
    setTournaments(tournamentRows);

    const entriesMap: Record<string, EntryRow[]> = {};
    const challengesMap: Record<string, Challenge[]> = {};
    for (const t of tournamentRows) {
      const { data: entries } = await supabase
        .from("tournament_entries")
        .select("*")
        .eq("tournament_id", t.id);
      const entryRows = (entries ?? []) as TournamentEntry[];
      const groupIds = entryRows.map((e) => e.group_id);
      const { data: names } = groupIds.length
        ? await supabase.from("groups").select("id,name").in("id", groupIds)
        : { data: [] };
      const nameMap = new Map((names ?? []).map((g) => [g.id, g.name as string]));
      entriesMap[t.id] = entryRows.map((e) => ({
        ...e,
        groupName: nameMap.get(e.group_id) ?? "Okänt lag",
      }));

      const { data: chals } = await supabase
        .from("challenges")
        .select("*")
        .eq("tournament_id", t.id)
        .order("created_at", { ascending: true });
      challengesMap[t.id] = (chals ?? []) as Challenge[];
    }
    setEntriesByTournament(entriesMap);
    setChallengesByTournament(challengesMap);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  async function createTournament() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    await supabase.rpc("create_tournament", {
      name: newName.trim(),
      description: newDesc.trim() || null,
      entry_fee_ore: Math.round(Number(newFeeKr) * 100),
      prize_pool_ore: Math.round(Number(newPrizeKr) * 100),
    });
    setNewName("");
    setNewDesc("");
    setBusy(false);
    void load();
  }

  async function setEntryPaid(entryId: string) {
    setBusy(true);
    await supabase.rpc("set_entry_payment_status", { eid: entryId, new_status: "paid" });
    setBusy(false);
    void load();
  }

  async function createChallenge(tournamentId: string) {
    const title = (newChallengeTitle[tournamentId] ?? "").trim();
    if (!title || busy) return;
    setBusy(true);
    await supabase.rpc("create_challenge", {
      tid: tournamentId,
      title,
      description: (newChallengeDesc[tournamentId] ?? "").trim() || null,
    });
    setNewChallengeTitle((prev) => ({ ...prev, [tournamentId]: "" }));
    setNewChallengeDesc((prev) => ({ ...prev, [tournamentId]: "" }));
    setBusy(false);
    void load();
  }

  async function openChallenge(id: string) {
    setBusy(true);
    await supabase.rpc("open_challenge", { cid: id, submission_hours: 72 });
    setBusy(false);
    void load();
  }

  async function lockPicks(id: string) {
    setBusy(true);
    await supabase.rpc("lock_challenge_picks", { cid: id });
    setBusy(false);
    void load();
  }

  async function distribute(id: string) {
    setBusy(true);
    await supabase.rpc("distribute_challenge", { cid: id, voting_hours: 24 });
    setBusy(false);
    void load();
  }

  async function score(id: string) {
    setBusy(true);
    await supabase.rpc("score_challenge", { cid: id });
    setBusy(false);
    void load();
  }

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
        <Pressable onPress={goBack} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Hantera turneringar</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Ny turnering</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Namn"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <TextInput
            value={newDesc}
            onChangeText={setNewDesc}
            placeholder="Beskrivning (valfritt)"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <View style={styles.row}>
            <TextInput
              value={newFeeKr}
              onChangeText={setNewFeeKr}
              placeholder="Insats (kr)"
              keyboardType="numeric"
              placeholderTextColor={c.textSecondary}
              style={[styles.input, styles.rowInput, { color: c.text, borderColor: c.backgroundSelected }]}
            />
            <TextInput
              value={newPrizeKr}
              onChangeText={setNewPrizeKr}
              placeholder="Prispott (kr)"
              keyboardType="numeric"
              placeholderTextColor={c.textSecondary}
              style={[styles.input, styles.rowInput, { color: c.text, borderColor: c.backgroundSelected }]}
            />
          </View>
          <Pressable
            onPress={createTournament}
            disabled={busy}
            style={[styles.primaryBtn, { backgroundColor: c.brand, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={styles.primaryBtnText}>Skapa turnering</Text>
          </Pressable>

          {tournaments.map((t) => (
            <View key={t.id} style={[styles.tournamentCard, { backgroundColor: c.backgroundElement }]}>
              <Text style={[styles.tournamentTitle, { color: c.text }]}>{t.name}</Text>

              <Text style={[styles.subTitle, { color: c.textSecondary }]}>Anmälningar</Text>
              {(entriesByTournament[t.id] ?? []).length === 0 ? (
                <Text style={{ color: c.textSecondary, fontSize: 13 }}>Inga anmälningar än.</Text>
              ) : (
                entriesByTournament[t.id].map((e) => (
                  <View key={e.id} style={styles.entryRow}>
                    <Text style={{ color: c.text, flex: 1 }}>{e.groupName}</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 12, marginRight: 8 }}>
                      {e.payment_status}
                    </Text>
                    {e.payment_status !== "paid" ? (
                      <Pressable
                        onPress={() => setEntryPaid(e.id)}
                        disabled={busy}
                        style={[styles.smallBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.smallBtnText}>Markera betald</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}

              <Text style={[styles.subTitle, { color: c.textSecondary }]}>Nytt uppdrag</Text>
              <TextInput
                value={newChallengeTitle[t.id] ?? ""}
                onChangeText={(v) => setNewChallengeTitle((prev) => ({ ...prev, [t.id]: v }))}
                placeholder="Titel, t.ex. 'Sjukaste festbilden'"
                placeholderTextColor={c.textSecondary}
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
              />
              <TextInput
                value={newChallengeDesc[t.id] ?? ""}
                onChangeText={(v) => setNewChallengeDesc((prev) => ({ ...prev, [t.id]: v }))}
                placeholder="Beskrivning (valfritt)"
                placeholderTextColor={c.textSecondary}
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
              />
              <Pressable
                onPress={() => createChallenge(t.id)}
                disabled={busy}
                style={[styles.smallBtn, { backgroundColor: c.brand, alignSelf: "flex-start" }]}
              >
                <Text style={styles.smallBtnText}>Skapa uppdrag</Text>
              </Pressable>

              <Text style={[styles.subTitle, { color: c.textSecondary }]}>Uppdrag</Text>
              {(challengesByTournament[t.id] ?? []).map((ch) => (
                <View key={ch.id} style={styles.challengeRow}>
                  <Text style={{ color: c.text, fontWeight: "700" }}>{ch.title}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12, marginBottom: 6 }}>
                    Status: {ch.status}
                  </Text>
                  <View style={styles.actionRow}>
                    {ch.status === "draft" ? (
                      <Pressable
                        onPress={() => openChallenge(ch.id)}
                        disabled={busy}
                        style={[styles.smallBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.smallBtnText}>Öppna (72h)</Text>
                      </Pressable>
                    ) : null}
                    {ch.status === "open" ? (
                      <Pressable
                        onPress={() => lockPicks(ch.id)}
                        disabled={busy}
                        style={[styles.smallBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.smallBtnText}>Lås topp-3</Text>
                      </Pressable>
                    ) : null}
                    {ch.status === "picks_locked" ? (
                      <Pressable
                        onPress={() => distribute(ch.id)}
                        disabled={busy}
                        style={[styles.smallBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.smallBtnText}>Fördela (24h röstning)</Text>
                      </Pressable>
                    ) : null}
                    {ch.status === "voting" ? (
                      <Pressable
                        onPress={() => score(ch.id)}
                        disabled={busy}
                        style={[styles.smallBtn, { backgroundColor: c.brand }]}
                      >
                        <Text style={styles.smallBtnText}>Räkna poäng</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ))}
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
  sectionTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  subTitle: { fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8 },
  rowInput: { flex: 1 },
  primaryBtn: { borderRadius: 14, paddingVertical: 13, alignItems: "center", marginBottom: 8 },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  tournamentCard: { borderRadius: 16, padding: 16, marginTop: 20 },
  tournamentTitle: { fontSize: 17, fontWeight: "800" },
  entryRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  challengeRow: { marginBottom: 12 },
  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  smallBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
