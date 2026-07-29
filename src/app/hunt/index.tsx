import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { getChatMediaUrl, uploadChatMedia } from "@/lib/chatMedia";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  HUNT_SERIF as SERIF,
  isVideoPath,
  TIER_ORDER,
  TIERS,
} from "@/lib/huntCards";
import type { Category, HuntChallenge, HuntCompletion, Tier } from "@/lib/huntCards";
import { CategoryArt } from "@/lib/huntArt";
import { AppIcon } from "@/components/AppIcon";
import { Icon } from "@/components/Icon";
import { supabase } from "@/lib/supabase";

// ============================================================
// Poängjakten: 100 utmaningar som tarotliknande samlarkort.
// Kortdata bor i hunt_challenges; klarmarkering + vittnesflöde
// går via RPC:erna hunt_claim/hunt_respond (se migration 0021).
// Kortens utseende delas med LadBook via src/lib/huntCards.
// ============================================================

type WitnessRequest = HuntCompletion & {
  claimantName: string;
  challenge?: HuntChallenge;
  proofSignedUrl: string | null;
  proofIsVideo: boolean;
};

type StatusFilter = "alla" | "oklarade" | "klarade";

/** Gruppens senaste bekräftade bragder (visas när jakten öppnas från en grupp). */
type GroupFeat = {
  id: string;
  name: string;
  challengeName: string;
  points: number;
  proofUrl: string | null;
  proofIsVideo: boolean;
};

function KlaradStamp({ small }: { small?: boolean }) {
  return (
    <View pointerEvents="none" style={styles.stampWrap}>
      <View style={[styles.stamp, small ? styles.stampSmall : null]}>
        <Text style={[styles.stampText, small ? { fontSize: 13 } : null]}>KLARAD</Text>
      </View>
    </View>
  );
}

/** Diamantkortens shimmer: mjukt pulserande glans. */
function useShimmer() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.6] });
}

export default function HuntScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  // Öppnad från en gruppchatt: jakten visas i den gruppens kontext.
  const { groupId: contextGroupId } = useLocalSearchParams<{ groupId?: string }>();
  const [contextGroupName, setContextGroupName] = useState<string | null>(null);
  const [groupFeats, setGroupFeats] = useState<GroupFeat[]>([]);
  const [galleryFeat, setGalleryFeat] = useState<GroupFeat | null>(null);
  const [groupFeatCount, setGroupFeatCount] = useState(0);
  const [groupFeatPoints, setGroupFeatPoints] = useState(0);

  const [challenges, setChallenges] = useState<HuntChallenge[]>([]);
  const [completions, setCompletions] = useState<Record<number, HuntCompletion>>({});
  const [witnessReqs, setWitnessReqs] = useState<WitnessRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [tierFilter, setTierFilter] = useState<Tier | "alla">("alla");
  const [catFilter, setCatFilter] = useState<Category | "alla">("alla");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alla");

  const [selected, setSelected] = useState<HuntChallenge | null>(null);
  const shimmer = useShimmer();

  // ---------- Klarmarkeringsflödet i modalen ----------
  const [claiming, setClaiming] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [claimGroup, setClaimGroup] = useState<string | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [witness, setWitness] = useState<string | null>(null);
  const [bonus, setBonus] = useState(false);
  const [proof, setProof] = useState<{ uri: string; mime: string; video: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!userId) return;
    const [chRes, compRes, witRes] = await Promise.all([
      supabase.from("hunt_challenges").select("*").order("id"),
      supabase.from("hunt_completions").select("*").eq("user_id", userId),
      supabase
        .from("hunt_completions")
        .select("*")
        .eq("witness_user_id", userId)
        .eq("status", "pending"),
    ]);
    const ch = (chRes.data ?? []) as HuntChallenge[];
    setChallenges(ch);
    setCompletions(
      Object.fromEntries(
        ((compRes.data ?? []) as HuntCompletion[]).map((c) => [c.challenge_id, c]),
      ),
    );

    const reqs = (witRes.data ?? []) as HuntCompletion[];
    const claimantIds = [...new Set(reqs.map((r) => r.user_id))];
    let names: Record<string, string> = {};
    if (claimantIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", claimantIds);
      names = Object.fromEntries(
        (profs ?? []).map((p) => [p.id as string, (p.display_name || p.email || "Okänd") as string]),
      );
    }
    setWitnessReqs(
      await Promise.all(
        reqs.map(async (r) => ({
          ...r,
          claimantName: names[r.user_id] ?? "Okänd",
          challenge: ch.find((c) => c.id === r.challenge_id),
          proofSignedUrl: r.proof_url ? await getChatMediaUrl(r.proof_url) : null,
          proofIsVideo: r.proof_url ? isVideoPath(r.proof_url) : false,
        })),
      ),
    );
    // Gruppkontext: namn + gruppens samlade bekräftade bragder.
    if (contextGroupId) {
      const [{ data: grp }, { data: feats }] = await Promise.all([
        supabase.from("groups").select("name").eq("id", contextGroupId).maybeSingle(),
        supabase
          .from("hunt_completions")
          .select("id, user_id, challenge_id, points_awarded, proof_url")
          .eq("group_id", contextGroupId)
          .eq("status", "confirmed")
          .order("responded_at", { ascending: false }),
      ]);
      setContextGroupName((grp?.name as string) ?? null);
      const rows = (feats ?? []) as {
        id: string;
        user_id: string;
        challenge_id: number;
        points_awarded: number;
        proof_url: string | null;
      }[];
      setGroupFeatCount(rows.length);
      setGroupFeatPoints(rows.reduce((sum, r) => sum + r.points_awarded, 0));
      const featUserIds = [...new Set(rows.map((r) => r.user_id))];
      let featNames: Record<string, string> = {};
      if (featUserIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,display_name,email")
          .in("id", featUserIds);
        featNames = Object.fromEntries(
          (profs ?? []).map((p) => [
            p.id as string,
            (p.display_name || p.email || "Okänd") as string,
          ]),
        );
      }
      setGroupFeats(
        await Promise.all(
          rows.slice(0, 12).map(async (r) => ({
            id: r.id,
            name: featNames[r.user_id] ?? "Okänd",
            challengeName: ch.find((x) => x.id === r.challenge_id)?.name ?? "?",
            points: r.points_awarded,
            proofUrl: r.proof_url ? await getChatMediaUrl(r.proof_url) : null,
            proofIsVideo: r.proof_url ? isVideoPath(r.proof_url) : false,
          })),
        ),
      );
    }
    setLoading(false);
  }, [userId, contextGroupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmed = useMemo(
    () => Object.values(completions).filter((c) => c.status === "confirmed"),
    [completions],
  );
  const totalPoints = confirmed.reduce((sum, c) => sum + c.points_awarded, 0);

  const filtered = useMemo(
    () =>
      challenges.filter((ch) => {
        if (tierFilter !== "alla" && ch.tier !== tierFilter) return false;
        if (catFilter !== "alla" && ch.category !== catFilter) return false;
        const st = completions[ch.id]?.status;
        if (statusFilter === "klarade") return st === "confirmed";
        if (statusFilter === "oklarade") return st !== "confirmed";
        return true;
      }),
    [challenges, tierFilter, catFilter, statusFilter, completions],
  );

  function openCard(ch: HuntChallenge) {
    setSelected(ch);
    setClaiming(false);
    setClaimGroup(null);
    setWitness(null);
    setBonus(false);
    setProof(null);
    setError(null);
    flip.setValue(0);
    Animated.timing(flip, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }

  async function startClaim() {
    if (!userId) return;
    setClaiming(true);
    setError(null);
    const { data } = await supabase
      .from("groups")
      .select("id,name,group_members!inner(user_id)")
      .eq("group_members.user_id", userId);
    const mine = ((data ?? []) as { id: string; name: string }[]).map((g) => ({
      id: g.id,
      name: g.name,
    }));
    setGroups(mine);
    // Öppnad från en grupp: förvälj den direkt.
    if (contextGroupId && mine.some((g) => g.id === contextGroupId)) {
      void pickGroup(contextGroupId);
    }
  }

  async function pickGroup(gid: string) {
    setClaimGroup(gid);
    setWitness(null);
    const { data: gm } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", gid);
    const ids = (gm ?? []).map((m) => m.user_id as string).filter((id) => id !== userId);
    if (ids.length === 0) {
      setMembers([]);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,display_name,email")
      .in("id", ids);
    setMembers(
      (profs ?? []).map((p) => ({
        id: p.id as string,
        name: (p.display_name || p.email || "Okänd") as string,
      })),
    );
  }

  async function pickProofFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.7,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const video = asset.type === "video";
    setProof({
      uri: asset.uri,
      mime: asset.mimeType ?? (video ? "video/mp4" : "image/jpeg"),
      video,
    });
  }

  async function takeProofPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setProof({ uri: asset.uri, mime: asset.mimeType ?? "image/jpeg", video: false });
  }

  async function submitClaim() {
    if (!selected || !claimGroup || !witness || !proof || !userId || sending) return;
    setSending(true);
    setError(null);
    try {
      const proofPath = await uploadChatMedia(claimGroup, userId, proof.uri, proof.mime);
      const { error: rpcError } = await supabase.rpc("hunt_claim", {
        cid: selected.id,
        gid: claimGroup,
        witness,
        proof: proofPath,
        bonus,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      await load();
      setClaiming(false);
    } catch {
      setError("Uppladdningen av beviset misslyckades — försök igen.");
    } finally {
      setSending(false);
    }
  }

  async function respond(completionId: string, approve: boolean) {
    await supabase.rpc("hunt_respond", { completion_id: completionId, approve });
    await load();
  }

  const sel = selected;
  const selTier = sel ? TIERS[sel.tier] : null;
  const selCompletion = sel ? completions[sel.id] : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Icon name="chevron-left" size={26} color="#84828C" />
        </Pressable>
        <Text style={styles.headerTitle}>
          Poängjakten{contextGroupName ? ` · ${contextGroupName}` : ""}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(ch) => String(ch.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 8, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={styles.top}>
              <View style={styles.progressCard}>
                <Text style={styles.progressBig}>
                  {confirmed.length} <Text style={styles.progressDim}>av {challenges.length} klarade</Text>
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${(confirmed.length / Math.max(1, challenges.length)) * 100}%` },
                    ]}
                  />
                </View>
                <View style={styles.iconRow}>
                  <AppIcon name="star" size={13} color="#00B884" />
                  <Text style={styles.progressDim}>{totalPoints} poäng insamlade i jakten</Text>
                </View>
              </View>

              {contextGroupId ? (
                <View style={styles.progressCard}>
                  <View style={styles.iconRow}>
                    <AppIcon name="shield" size={16} color="#15151B" />
                    <Text style={styles.progressBig}>
                      {contextGroupName ?? "Gruppen"}s jakt
                    </Text>
                  </View>
                  <Text style={styles.progressDim}>
                    {groupFeatCount} bekräftade bragder · {groupFeatPoints} poäng till laget
                  </Text>
                  {groupFeats.slice(0, 4).map((f) => (
                    <View key={f.id} style={styles.iconRow}>
                      <AppIcon name="medal" size={13} color="#00B884" />
                      <Text style={styles.progressDim}>
                        {f.name} klarade {"”"}{f.challengeName}{"”"} (+{f.points}p)
                      </Text>
                    </View>
                  ))}
                  {groupFeats.some((f) => f.proofUrl) ? (
                    <>
                      <View style={[styles.iconRow, { marginTop: 4 }]}>
                        <AppIcon name="film" size={13} color="#84828C" />
                        <Text style={[styles.progressDim, { fontWeight: "800" }]}>
                          Gruppens höjdpunkter
                        </Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {groupFeats
                            .filter((f) => f.proofUrl)
                            .map((f) => (
                              <Pressable
                                key={f.id}
                                onPress={() => setGalleryFeat(f)}
                                style={styles.galleryThumbWrap}
                              >
                                {f.proofIsVideo ? (
                                  <View style={styles.galleryThumbVideo}>
                                    <AppIcon name="film" size={22} color="#F5F4F0" />
                                  </View>
                                ) : (
                                  <Image
                                    source={{ uri: f.proofUrl! }}
                                    style={styles.galleryThumb}
                                  />
                                )}
                              </Pressable>
                            ))}
                        </View>
                      </ScrollView>
                    </>
                  ) : null}
                </View>
              ) : null}

              {witnessReqs.length > 0 ? (
                <View style={styles.witnessBox}>
                  <View style={styles.iconRow}>
                    <AppIcon name="eye" size={15} color="#15151B" />
                    <Text style={styles.witnessTitle}>Du är kallad som vittne</Text>
                  </View>
                  {witnessReqs.map((r) => (
                    <View key={r.id} style={styles.witnessRow}>
                      <Text style={styles.witnessText}>
                        {r.claimantName} hävdar: {"”"}{r.challenge?.name ?? "?"}{"”"}
                        {r.bonus_claimed ? " (+bonus)" : ""}
                      </Text>
                      {r.proofSignedUrl ? (
                        r.proofIsVideo ? (
                          <Pressable
                            onPress={() => Linking.openURL(r.proofSignedUrl!)}
                            style={[styles.proofVideoBtn, styles.iconRow]}
                          >
                            <AppIcon name="film" size={15} color="#F5F4F0" />
                            <Text style={styles.btnText}>Visa videobevis</Text>
                          </Pressable>
                        ) : (
                          <Pressable onPress={() => Linking.openURL(r.proofSignedUrl!)}>
                            <Image
                              source={{ uri: r.proofSignedUrl }}
                              style={styles.proofThumb}
                            />
                          </Pressable>
                        )
                      ) : (
                        <Text style={styles.witnessNoProof}>Bevis saknas (äldre klarmarkering)</Text>
                      )}
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable onPress={() => respond(r.id, true)} style={styles.confirmBtn}>
                          <Text style={styles.btnText}>Bekräfta</Text>
                        </Pressable>
                        <Pressable onPress={() => respond(r.id, false)} style={styles.denyBtn}>
                          <Text style={styles.btnText}>Neka</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.filterRow}>
                  <Pressable
                    onPress={() => setTierFilter("alla")}
                    style={[styles.filterChip, tierFilter === "alla" ? styles.filterChipOn : null]}
                  >
                    <Text style={styles.filterText}>Alla</Text>
                  </Pressable>
                  {TIER_ORDER.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setTierFilter(t)}
                      style={[styles.filterChip, styles.iconRow, tierFilter === t ? styles.filterChipOn : null]}
                    >
                      <AppIcon name={TIERS[t].icon} size={13} color={TIERS[t].frameDark} />
                      <Text style={styles.filterText}>{TIERS[t].label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.filterRow}>
                  <Pressable
                    onPress={() => setCatFilter("alla")}
                    style={[styles.filterChip, catFilter === "alla" ? styles.filterChipOn : null]}
                  >
                    <Text style={styles.filterText}>Alla kategorier</Text>
                  </Pressable>
                  {CATEGORY_ORDER.map((cat) => (
                    <Pressable
                      key={cat}
                      onPress={() => setCatFilter(cat)}
                      style={[styles.filterChip, styles.iconRow, catFilter === cat ? styles.filterChipOn : null]}
                    >
                      <AppIcon name={CATEGORIES[cat].icon} size={13} color="#15151B" />
                      <Text style={styles.filterText}>{CATEGORIES[cat].label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.filterRow}>
                {(["alla", "oklarade", "klarade"] as StatusFilter[]).map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setStatusFilter(s)}
                    style={[styles.filterChip, statusFilter === s ? styles.filterChipOn : null]}
                  >
                    <Text style={styles.filterText}>{s[0].toUpperCase() + s.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const t = TIERS[item.tier];
            const st = completions[item.id]?.status;
            return (
              <Pressable onPress={() => openCard(item)} style={{ flex: 1 / 3 }}>
                <View style={[styles.cardBack, { borderColor: t.frame, backgroundColor: t.face }]}>
                  <View style={[styles.cardInnerFrame, { borderColor: t.frameDark }]}>
                    <CategoryArt category={item.category} seed={item.id} />
                    <View style={styles.cornerSymbol}>
                      <AppIcon name={t.icon} size={12} color={t.frameDark} />
                    </View>
                    <View style={styles.cornerCategory}>
                      <AppIcon name={CATEGORIES[item.category].icon} size={11} color={t.frameDark} />
                    </View>
                    <Text style={[styles.cardName, { color: t.text }]} numberOfLines={3}>
                      {item.name.toUpperCase()}
                    </Text>
                    <Text style={[styles.cardTierLabel, { color: t.frameDark }]}>
                      {t.label} · {item.points}p
                    </Text>
                  </View>
                  {item.tier === "diamond" ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[styles.shimmer, { opacity: shimmer }]}
                    />
                  ) : null}
                  {st === "confirmed" ? <KlaradStamp small /> : null}
                  {st === "pending" ? (
                    <View style={styles.pendingBadge}>
                      <AppIcon name="hourglass" size={11} color={t.frameDark} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* ---------- Öppnat kort ---------- */}
      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalDim}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            {sel && selTier ? (
              <Animated.View
                style={[
                  styles.bigCard,
                  { borderColor: selTier.frame, backgroundColor: selTier.face },
                  {
                    transform: [
                      { perspective: 1000 },
                      {
                        rotateY: flip.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["90deg", "0deg"],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={[styles.bigInnerFrame, { borderColor: selTier.frameDark }]}>
                  <View style={styles.bigTopRow}>
                    <AppIcon name={selTier.icon} size={20} color={selTier.frameDark} />
                    <Text style={[styles.bigTier, { color: selTier.frameDark }]}>
                      {selTier.label}
                    </Text>
                    <AppIcon name={selTier.icon} size={20} color={selTier.frameDark} />
                  </View>

                  <Text style={[styles.bigName, { color: selTier.text }]}>
                    {sel.name.toUpperCase()}
                  </Text>
                  <View style={[styles.iconRow, { justifyContent: "center" }]}>
                    <AppIcon
                      name={CATEGORIES[sel.category].icon}
                      size={13}
                      color={selTier.frameDark}
                    />
                    <Text style={[styles.bigCategory, { color: selTier.frameDark }]}>
                      {CATEGORIES[sel.category].label}
                    </Text>
                  </View>
                  <Text style={[styles.ornament, { color: selTier.frame }]}>✦ ─────── ✦</Text>

                  <Text style={[styles.bigDesc, { color: selTier.text }]}>{sel.description}</Text>

                  <View style={[styles.iconRow, { justifyContent: "center" }]}>
                    <AppIcon name="star" size={15} color={selTier.text} />
                    <Text style={[styles.bigPoints, { color: selTier.text }]}>
                      {sel.points} poäng
                    </Text>
                  </View>
                  {sel.bonus_points ? (
                    <View style={[styles.iconRow, { justifyContent: "center" }]}>
                      <AppIcon name="sparkles" size={12} color={selTier.frameDark} />
                      <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                        Bonus +{sel.bonus_points}p: {sel.bonus_condition}
                      </Text>
                    </View>
                  ) : null}
                  {sel.requires_alcohol ? (
                    <View style={[styles.iconRow, { justifyContent: "center" }]}>
                      <AppIcon name="warning" size={12} color="#FF4C29" />
                      <Text style={styles.alcoholNote}>
                        Alkoholfritt alternativ gäller alltid — drick ansvarsfullt, aldrig under 18.
                      </Text>
                    </View>
                  ) : null}

                  {selCompletion?.status === "confirmed" ? (
                    <View style={styles.doneRow}>
                      <Text style={[styles.bigPoints, { color: "#FF4C29" }]}>
                        Klarad — +{selCompletion.points_awarded}p
                      </Text>
                    </View>
                  ) : selCompletion?.status === "pending" ? (
                    <View style={[styles.iconRow, { justifyContent: "center" }]}>
                      <AppIcon name="hourglass" size={12} color={selTier.frameDark} />
                      <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                        Väntar på vittnets bekräftelse…
                      </Text>
                    </View>
                  ) : !claiming ? (
                    <Pressable onPress={startClaim} style={styles.claimBtn}>
                      <Text style={styles.btnText}>Klarmarkera</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.claimBox}>
                      <Text style={[styles.claimLabel, { color: selTier.text }]}>
                        I vilken grupp skedde bragden?
                      </Text>
                      <View style={styles.chipWrap}>
                        {groups.map((g) => (
                          <Pressable
                            key={g.id}
                            onPress={() => pickGroup(g.id)}
                            style={[styles.pickChip, claimGroup === g.id ? styles.pickChipOn : null]}
                          >
                            <Text style={styles.pickChipText}>{g.name}</Text>
                          </Pressable>
                        ))}
                      </View>

                      {claimGroup ? (
                        <>
                          <Text style={[styles.claimLabel, { color: selTier.text }]}>
                            Vittne som intygar:
                          </Text>
                          {members.length === 0 ? (
                            <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                              Inga andra medlemmar i gruppen — vittnet måste vara en polare i samma
                              grupp.
                            </Text>
                          ) : (
                            <View style={styles.chipWrap}>
                              {members.map((m) => (
                                <Pressable
                                  key={m.id}
                                  onPress={() => setWitness(m.id)}
                                  style={[
                                    styles.pickChip,
                                    witness === m.id ? styles.pickChipOn : null,
                                  ]}
                                >
                                  <Text style={styles.pickChipText}>{m.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                        </>
                      ) : null}

                      {claimGroup ? (
                        <>
                          <Text style={[styles.claimLabel, { color: selTier.text }]}>
                            Bevis (obligatoriskt) — bild eller video:
                          </Text>
                          <View style={styles.chipWrap}>
                            <Pressable onPress={takeProofPhoto} style={[styles.pickChip, styles.iconRow]}>
                              <AppIcon name="camera" size={14} color={selTier.text} />
                              <Text style={styles.pickChipText}>Ta foto</Text>
                            </Pressable>
                            <Pressable
                              onPress={pickProofFromLibrary}
                              style={[styles.pickChip, styles.iconRow]}
                            >
                              <AppIcon name="image" size={14} color={selTier.text} />
                              <Text style={styles.pickChipText}>Välj bild/video</Text>
                            </Pressable>
                          </View>
                          {proof ? (
                            proof.video ? (
                              <View style={[styles.iconRow, { justifyContent: "center" }]}>
                                <AppIcon name="film" size={12} color={selTier.frameDark} />
                                <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                                  Video vald — bifogas när du skickar.
                                </Text>
                              </View>
                            ) : (
                              <Image source={{ uri: proof.uri }} style={styles.proofPreview} />
                            )
                          ) : (
                            <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                              Inget bevis valt än — vittnet ser beviset innan bekräftelse.
                            </Text>
                          )}
                        </>
                      ) : null}

                      {sel.bonus_points && claimGroup ? (
                        <View style={styles.bonusRow}>
                          <Text style={[styles.claimLabel, { color: selTier.text, flexShrink: 1 }]}>
                            Bonus uppnådd? ({sel.bonus_condition})
                          </Text>
                          <Switch value={bonus} onValueChange={setBonus} />
                        </View>
                      ) : null}

                      {error ? <Text style={styles.error}>{error}</Text> : null}

                      <Pressable
                        onPress={submitClaim}
                        disabled={!claimGroup || !witness || !proof || sending}
                        style={[
                          styles.claimBtn,
                          !claimGroup || !witness || !proof || sending ? { opacity: 0.4 } : null,
                        ]}
                      >
                        <Text style={styles.btnText}>
                          {sending ? "Laddar upp bevis…" : "Skicka till vittnet"}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  <Text style={[styles.themeCaption, { color: selTier.frameDark }]}>
                    {sel.background_theme}
                  </Text>
                </View>

                {sel.tier === "diamond" ? (
                  <Animated.View pointerEvents="none" style={[styles.shimmer, { opacity: shimmer }]} />
                ) : null}
                {selCompletion?.status === "confirmed" ? <KlaradStamp /> : null}
              </Animated.View>
            ) : null}
            <Pressable onPress={() => setSelected(null)} style={styles.closeBtn}>
              <Text style={styles.btnText}>Stäng</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
      {/* Bevisvisare för gruppens höjdpunkter. */}
      <Modal
        visible={!!galleryFeat}
        transparent
        animationType="fade"
        onRequestClose={() => setGalleryFeat(null)}
      >
        <Pressable
          style={styles.galleryLightbox}
          onPress={() => setGalleryFeat(null)}
        >
          {galleryFeat?.proofIsVideo && galleryFeat.proofUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(galleryFeat.proofUrl!)}
              style={[styles.confirmBtn, styles.iconRow]}
            >
              <AppIcon name="film" size={15} color="#F5F4F0" />
              <Text style={styles.btnText}>Öppna videobeviset</Text>
            </Pressable>
          ) : galleryFeat?.proofUrl ? (
            <Image
              source={{ uri: galleryFeat.proofUrl }}
              style={{ width: "100%", height: "80%" }}
              resizeMode="contain"
            />
          ) : null}
          {galleryFeat ? (
            <Text style={{ color: "#fff", fontWeight: "800", marginTop: 10 }}>
              {galleryFeat.name} · {"”"}{galleryFeat.challengeName}{"”"} (+{galleryFeat.points}p)
            </Text>
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F4F0" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: "#15151B", fontSize: 19, fontWeight: "800", fontFamily: SERIF },
  top: { paddingHorizontal: 16, gap: 10, paddingBottom: 12 },
  progressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E1DED5",
  },
  progressBig: { color: "#15151B", fontSize: 20, fontWeight: "800", fontFamily: SERIF },
  progressDim: { color: "#84828C", fontSize: 13 },
  progressTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: "#E1DED5",
    overflow: "hidden",
  },
  progressFill: { height: 8, backgroundColor: "#3D5AFE" },
  galleryThumbWrap: { borderRadius: 8, overflow: "hidden" },
  galleryThumb: { width: 84, height: 84, borderRadius: 8 },
  galleryThumbVideo: {
    width: 84,
    height: 84,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryLightbox: {
    flex: 1,
    backgroundColor: "rgba(10,6,18,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  witnessBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#3D5AFE",
  },
  witnessTitle: { color: "#15151B", fontWeight: "800", fontSize: 15, fontFamily: SERIF },
  witnessRow: { gap: 8 },
  witnessText: { color: "#15151B", fontSize: 14 },
  witnessNoProof: { color: "#84828C", fontSize: 12, fontStyle: "italic" },
  proofThumb: { width: 120, height: 120, borderRadius: 8, backgroundColor: "#000" },
  proofVideoBtn: {
    backgroundColor: "#15151B",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  proofPreview: {
    width: "100%",
    height: 160,
    borderRadius: 8,
    backgroundColor: "#000",
  },
  confirmBtn: {
    backgroundColor: "#00B884",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  denyBtn: {
    backgroundColor: "#FF4C29",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterChipOn: { borderColor: "#3D5AFE", backgroundColor: "#E9EDFF" },
  filterText: { color: "#15151B", fontWeight: "700", fontSize: 13 },

  cardBack: {
    aspectRatio: 0.68,
    borderRadius: 8,
    borderWidth: 3,
    padding: 4,
    overflow: "hidden",
  },
  cardInnerFrame: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    gap: 4,
  },
  cornerSymbol: { position: "absolute", top: 4, left: 5 },
  cornerCategory: { position: "absolute", top: 4, right: 5 },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bigCategory: {
    fontFamily: SERIF,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 2,
  },
  cardName: {
    fontFamily: SERIF,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  cardTierLabel: { fontSize: 10, fontWeight: "700", position: "absolute", bottom: 4 },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#dff4ff",
  },
  pendingBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    padding: 2,
  },
  stampWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  stamp: {
    borderWidth: 3,
    borderColor: "#FF4C29",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    transform: [{ rotate: "-18deg" }],
    backgroundColor: "rgba(255,76,41,0.08)",
  },
  stampSmall: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 2 },
  stampText: { color: "#FF4C29", fontWeight: "900", fontSize: 20, letterSpacing: 2 },

  modalDim: { flex: 1, backgroundColor: "rgba(21,21,27,0.88)" },
  modalScroll: { padding: 20, paddingTop: 48, alignItems: "center", gap: 14, paddingBottom: 60 },
  bigCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 8,
    borderWidth: 5,
    padding: 8,
    overflow: "hidden",
  },
  bigInnerFrame: { borderWidth: 1.5, borderRadius: 8, padding: 16, gap: 10 },
  bigTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bigTier: { fontFamily: SERIF, fontSize: 14, fontWeight: "700", letterSpacing: 3 },
  bigName: {
    fontFamily: SERIF,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 1.5,
  },
  ornament: { textAlign: "center", fontSize: 12 },
  bigDesc: { fontFamily: SERIF, fontSize: 16, lineHeight: 23, textAlign: "center" },
  bigPoints: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  bigBonus: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  alcoholNote: { color: "#84828C", fontSize: 12, textAlign: "center", fontWeight: "600" },
  doneRow: { alignItems: "center" },
  claimBtn: {
    backgroundColor: "#3D5AFE",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  claimBox: { gap: 10 },
  claimLabel: { fontSize: 14, fontWeight: "700", fontFamily: SERIF },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pickChip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F5F4F0",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pickChipOn: { borderColor: "#3D5AFE", backgroundColor: "#E9EDFF" },
  pickChipText: { color: "#15151B", fontWeight: "700", fontSize: 13 },
  bonusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  error: { color: "#FF4C29", fontSize: 13, textAlign: "center" },
  themeCaption: { fontSize: 11, fontStyle: "italic", textAlign: "center", marginTop: 4 },
  closeBtn: {
    backgroundColor: "#E1DED5",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
});
