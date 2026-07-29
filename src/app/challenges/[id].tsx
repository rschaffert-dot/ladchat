import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { getSignedImageUrl, uploadChallengeImage } from "@/lib/challengeImages";
import { supabase } from "@/lib/supabase";
import type {
  Challenge,
  ChallengeDistribution,
  ChallengePickVote,
  ChallengeResult,
  ChallengeSubmission,
  Group,
} from "@/lib/types";
import { useColors } from "@/lib/ui";

type SubmissionWithVotes = ChallengeSubmission & { voteCount: number; imageUrl: string | null };
type ReceivedItem = { submission: ChallengeSubmission; imageUrl: string | null };
type ResultRow = ChallengeResult & { groupName: string };

export default function ChallengeScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const { id: challengeId } = useLocalSearchParams<{ id: string }>();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [myGroup, setMyGroup] = useState<Group | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionWithVotes[]>([]);
  const [myPickVotes, setMyPickVotes] = useState<Set<string>>(new Set());
  const [received, setReceived] = useState<ReceivedItem[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [hasSubmittedRanking, setHasSubmittedRanking] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!challengeId || !userId) return;

    const { data: ch } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .single();
    const challengeRow = ch as Challenge | null;
    setChallenge(challengeRow);
    if (!challengeRow) {
      setLoading(false);
      return;
    }

    // Hitta vilken av mina grupper som är betald deltagare i den här turneringen.
    const { data: myGroups } = await supabase
      .from("groups")
      .select("id,name,owner_id,created_at,beer_glass_size,beer_fill_cl,beer_round_started_at,beer_duration_minutes");
    const { data: entries } = await supabase
      .from("tournament_entries")
      .select("group_id")
      .eq("tournament_id", challengeRow.tournament_id)
      .eq("payment_status", "paid");
    const paidGroupIds = new Set((entries ?? []).map((e) => e.group_id as string));
    const group = ((myGroups ?? []) as Group[]).find((g) => paidGroupIds.has(g.id)) ?? null;
    setMyGroup(group);

    if (group) {
      const { data: subs } = await supabase
        .from("challenge_submissions")
        .select("*")
        .eq("challenge_id", challengeId)
        .eq("group_id", group.id)
        .order("created_at", { ascending: true });

      const { data: votes } = await supabase
        .from("challenge_pick_votes")
        .select("*")
        .eq("challenge_id", challengeId)
        .eq("group_id", group.id);

      const voteRows = (votes ?? []) as ChallengePickVote[];
      const counts = new Map<string, number>();
      voteRows.forEach((v) => counts.set(v.submission_id, (counts.get(v.submission_id) ?? 0) + 1));
      setMyPickVotes(new Set(voteRows.filter((v) => v.voter_id === userId).map((v) => v.submission_id)));

      const subsWithUrls = await Promise.all(
        ((subs ?? []) as ChallengeSubmission[]).map(async (s) => ({
          ...s,
          voteCount: counts.get(s.id) ?? 0,
          imageUrl: await getSignedImageUrl(s.image_path),
        })),
      );
      setSubmissions(subsWithUrls);

      // Mottagna bidrag från andra lag (om fördelning skett).
      const { data: dists } = await supabase
        .from("challenge_distributions")
        .select("*")
        .eq("challenge_id", challengeId)
        .eq("to_group_id", group.id);
      const distRows = (dists ?? []) as ChallengeDistribution[];
      if (distRows.length > 0) {
        const subIds = distRows.map((d) => d.submission_id);
        const { data: recvSubs } = await supabase
          .from("challenge_submissions")
          .select("*")
          .in("id", subIds);
        const recvWithUrls = await Promise.all(
          ((recvSubs ?? []) as ChallengeSubmission[]).map(async (s) => ({
            submission: s,
            imageUrl: await getSignedImageUrl(s.image_path),
          })),
        );
        setReceived(recvWithUrls);

        const { data: myRanking } = await supabase
          .from("challenge_votes")
          .select("submission_id, rank")
          .eq("challenge_id", challengeId)
          .eq("to_group_id", group.id)
          .eq("voter_id", userId)
          .order("rank", { ascending: true });
        if (myRanking && myRanking.length === distRows.length) {
          setRankOrder(myRanking.map((r) => r.submission_id as string));
          setHasSubmittedRanking(true);
        } else {
          setRankOrder(recvWithUrls.map((r) => r.submission.id));
          setHasSubmittedRanking(false);
        }
      }
    }

    if (challengeRow.status === "scored" || challengeRow.status === "completed") {
      const { data: res } = await supabase
        .from("challenge_results")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("points_awarded", { ascending: false });
      const resultRows = (res ?? []) as ChallengeResult[];
      const groupIds = resultRows.map((r) => r.group_id);
      const { data: names } = await supabase.from("groups").select("id,name").in("id", groupIds);
      const nameMap = new Map((names ?? []).map((g) => [g.id, g.name as string]));
      setResults(resultRows.map((r) => ({ ...r, groupName: nameMap.get(r.group_id) ?? "Okänt lag" })));
    }

    setLoading(false);
  }, [challengeId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function submitEntry() {
    if (!challengeId || !myGroup || !userId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const path = await uploadChallengeImage(
        challengeId,
        myGroup.id,
        userId,
        asset.uri,
        asset.mimeType ?? "image/jpeg",
      );
      await supabase.rpc("submit_challenge_entry", {
        cid: challengeId,
        gid: myGroup.id,
        image_url: path,
        caption: caption.trim() || null,
      });
      setCaption("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function togglePickVote(submissionId: string) {
    if (!challengeId || !myGroup) return;
    setBusy(true);
    try {
      if (myPickVotes.has(submissionId)) {
        await supabase.rpc("retract_pick_vote", { cid: challengeId, sid: submissionId });
      } else {
        if (myPickVotes.size >= 3) return;
        await supabase.rpc("cast_pick_vote", { cid: challengeId, gid: myGroup.id, sid: submissionId });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  function moveRank(submissionId: string, direction: -1 | 1) {
    setRankOrder((prev) => {
      const idx = prev.indexOf(submissionId);
      const next = idx + direction;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  async function submitRanking() {
    if (!challengeId || !myGroup) return;
    setBusy(true);
    try {
      await supabase.rpc("submit_rankings", {
        cid: challengeId,
        tgid: myGroup.id,
        submission_ids: rankOrder,
      });
      setHasSubmittedRanking(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !challenge) {
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
          {challenge.title}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {challenge.description ? (
          <Text style={[styles.desc, { color: c.textSecondary }]}>{challenge.description}</Text>
        ) : null}

        {!myGroup ? (
          <Text style={{ color: c.textSecondary, marginTop: 12 }}>
            Inget av dina lag är anmält och betalt för den här turneringen.
          </Text>
        ) : null}

        {myGroup && challenge.status === "open" ? (
          <>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Skicka in bidrag</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Bildtext (valfritt)…"
              placeholderTextColor={c.textSecondary}
              style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
            />
            <Pressable
              onPress={submitEntry}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: c.brand, opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={styles.primaryBtnText}>Välj bild och skicka in</Text>
            </Pressable>

            <Text style={[styles.sectionTitle, { color: c.text }]}>
              Ert lags bidrag — rösta på upp till 3 ({myPickVotes.size}/3)
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginBottom: 8 }}>
              Ni ser inte lagkamraters röster förrän ni röstat själva.
            </Text>
            {submissions.map((s) => (
              <View
                key={s.id}
                style={[styles.submissionCard, { backgroundColor: c.backgroundElement }]}
              >
                {s.imageUrl ? (
                  <Image source={{ uri: s.imageUrl }} style={styles.thumb} />
                ) : null}
                <View style={{ flex: 1 }}>
                  {s.caption ? (
                    <Text style={{ color: c.text, fontSize: 13 }}>{s.caption}</Text>
                  ) : null}
                  <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                    {myPickVotes.size > 0 || myPickVotes.has(s.id)
                      ? `${s.voteCount} röster`
                      : "Rösta för att se antal röster"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => togglePickVote(s.id)}
                  disabled={busy || (!myPickVotes.has(s.id) && myPickVotes.size >= 3)}
                  style={[
                    styles.voteBtn,
                    {
                      backgroundColor: myPickVotes.has(s.id) ? c.brand : c.backgroundSelected,
                    },
                  ]}
                >
                  <Text style={{ color: myPickVotes.has(s.id) ? "#fff" : c.text, fontWeight: "700" }}>
                    {myPickVotes.has(s.id) ? "Röstat" : "Rösta"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}

        {myGroup && (challenge.status === "picks_locked" || challenge.status === "distributed") ? (
          <Text style={{ color: c.textSecondary, marginTop: 12 }}>
            Bidragen är låsta. Väntar på att tävlingsledningen fördelar bilderna för röstning.
          </Text>
        ) : null}

        {myGroup && challenge.status === "voting" ? (
          <>
            <Text style={[styles.sectionTitle, { color: c.text }]}>
              Rangordna de mottagna bidragen (bäst överst)
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginBottom: 8 }}>
              Ni ser inte lagkamraters rangordning förrän ni skickat in er egen.
            </Text>
            {rankOrder.map((sid, idx) => {
              const item = received.find((r) => r.submission.id === sid);
              if (!item) return null;
              return (
                <View
                  key={sid}
                  style={[styles.submissionCard, { backgroundColor: c.backgroundElement }]}
                >
                  <Text style={[styles.rankNumber, { color: c.brand }]}>{idx + 1}</Text>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <View style={styles.rankButtons}>
                    <Pressable onPress={() => moveRank(sid, -1)} hitSlop={8}>
                      <Text style={{ color: c.text, fontSize: 20 }}>↑</Text>
                    </Pressable>
                    <Pressable onPress={() => moveRank(sid, 1)} hitSlop={8}>
                      <Text style={{ color: c.text, fontSize: 20 }}>↓</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Pressable
              onPress={submitRanking}
              disabled={busy || received.length === 0}
              style={[styles.primaryBtn, { backgroundColor: c.brand, opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={styles.primaryBtnText}>
                {hasSubmittedRanking ? "Uppdatera rangordning" : "Skicka in rangordning"}
              </Text>
            </Pressable>
          </>
        ) : null}

        {challenge.status === "scored" || challenge.status === "completed" ? (
          <>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Resultat</Text>
            {results.map((r, i) => (
              <View
                key={r.id}
                style={[styles.submissionCard, { backgroundColor: c.backgroundElement }]}
              >
                <Text style={{ color: c.textSecondary, width: 24 }}>{i + 1}.</Text>
                <Text style={{ color: c.text, fontWeight: "700", flex: 1 }}>{r.groupName}</Text>
                <Text style={{ color: c.brand, fontWeight: "800" }}>+{r.points_awarded}p</Text>
              </View>
            ))}
          </>
        ) : null}
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
    paddingVertical: 12,
  },
  back: { paddingHorizontal: 4 },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  desc: { fontSize: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginTop: 20, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  primaryBtn: { borderRadius: 0, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  submissionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 0,
    padding: 10,
    marginBottom: 8,
  },
  thumb: { width: 56, height: 56, borderRadius: 0 },
  voteBtn: { borderRadius: 0, paddingHorizontal: 12, paddingVertical: 8 },
  rankNumber: { fontSize: 18, fontWeight: "800", width: 24 },
  rankButtons: { gap: 4, alignItems: "center" },
});
