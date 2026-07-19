import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
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
import { supabase } from "@/lib/supabase";

// ============================================================
// Poängjakten: 100 utmaningar som tarotliknande samlarkort.
// Kortdata bor i hunt_challenges; klarmarkering + vittnesflöde
// går via RPC:erna hunt_claim/hunt_respond (se migration 0021).
// ============================================================

const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" });

type Tier = "wood" | "bronze" | "silver" | "gold" | "diamond";

type Category = "gang" | "social" | "charm" | "scen" | "fys" | "bar";

const CATEGORY_ORDER: Category[] = ["gang", "social", "charm", "scen", "fys", "bar"];

const CATEGORIES: Record<Category, { label: string; emoji: string }> = {
  gang: { label: "Gänget", emoji: "👊" },
  social: { label: "Främlingar", emoji: "🤝" },
  charm: { label: "Charm", emoji: "💘" },
  scen: { label: "Scenen", emoji: "🎤" },
  fys: { label: "Styrka & mod", emoji: "💪" },
  bar: { label: "Baren", emoji: "🍻" },
};

type HuntChallenge = {
  id: number;
  name: string;
  tier: Tier;
  category: Category;
  points: number;
  bonus_points: number | null;
  bonus_condition: string | null;
  description: string;
  background_theme: string;
  requires_alcohol: boolean;
};

type HuntCompletion = {
  id: string;
  challenge_id: number;
  user_id: string;
  group_id: string;
  witness_user_id: string;
  bonus_claimed: boolean;
  status: "pending" | "confirmed" | "denied";
  points_awarded: number;
  proof_url: string | null;
};

type WitnessRequest = HuntCompletion & {
  claimantName: string;
  challenge?: HuntChallenge;
  proofSignedUrl: string | null;
  proofIsVideo: boolean;
};

function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(path);
}

const TIER_ORDER: Tier[] = ["wood", "bronze", "silver", "gold", "diamond"];

const TIERS: Record<
  Tier,
  { label: string; symbol: string; frame: string; frameDark: string; face: string; text: string }
> = {
  wood: { label: "Trä", symbol: "🪵", frame: "#8a5a2b", frameDark: "#5d3c1c", face: "#efe0bd", text: "#4a3418" },
  bronze: { label: "Brons", symbol: "🥉", frame: "#b87333", frameDark: "#7c4a1e", face: "#f0ddba", text: "#5a3517" },
  silver: { label: "Silver", symbol: "🥈", frame: "#aab4bf", frameDark: "#6d7681", face: "#eef0ef", text: "#3c434b" },
  gold: { label: "Guld", symbol: "🏆", frame: "#d4af37", frameDark: "#96781f", face: "#f5e9c0", text: "#5c4a12" },
  diamond: { label: "Diamant", symbol: "💎", frame: "#8fd8f2", frameDark: "#4d94ad", face: "#e8f6fb", text: "#1f4b5a" },
};

type StatusFilter = "alla" | "oklarade" | "klarade";

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
    setLoading(false);
  }, [userId]);

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
    setGroups(
      ((data ?? []) as { id: string; name: string }[]).map((g) => ({ id: g.id, name: g.name })),
    );
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
          <Text style={{ color: "#d8c9a3", fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>🃏 Poängjakten</Text>
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
                <Text style={styles.progressDim}>⭐ {totalPoints} poäng insamlade i jakten</Text>
              </View>

              {witnessReqs.length > 0 ? (
                <View style={styles.witnessBox}>
                  <Text style={styles.witnessTitle}>🕯 Du är kallad som vittne</Text>
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
                            style={styles.proofVideoBtn}
                          >
                            <Text style={styles.btnText}>🎬 Visa videobevis</Text>
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
                      style={[styles.filterChip, tierFilter === t ? styles.filterChipOn : null]}
                    >
                      <Text style={styles.filterText}>
                        {TIERS[t].symbol} {TIERS[t].label}
                      </Text>
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
                      style={[styles.filterChip, catFilter === cat ? styles.filterChipOn : null]}
                    >
                      <Text style={styles.filterText}>
                        {CATEGORIES[cat].emoji} {CATEGORIES[cat].label}
                      </Text>
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
                    <Text style={styles.cornerSymbol}>{t.symbol}</Text>
                    <Text style={styles.cornerCategory}>{CATEGORIES[item.category].emoji}</Text>
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
                      <Text style={{ fontSize: 12 }}>⏳</Text>
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
                    <Text style={{ fontSize: 22 }}>{selTier.symbol}</Text>
                    <Text style={[styles.bigTier, { color: selTier.frameDark }]}>
                      {selTier.label}
                    </Text>
                    <Text style={{ fontSize: 22 }}>{selTier.symbol}</Text>
                  </View>

                  <Text style={[styles.bigName, { color: selTier.text }]}>
                    {sel.name.toUpperCase()}
                  </Text>
                  <Text style={[styles.bigCategory, { color: selTier.frameDark }]}>
                    {CATEGORIES[sel.category].emoji} {CATEGORIES[sel.category].label}
                  </Text>
                  <Text style={[styles.ornament, { color: selTier.frame }]}>✦ ─────── ✦</Text>

                  <Text style={[styles.bigDesc, { color: selTier.text }]}>{sel.description}</Text>

                  <Text style={[styles.bigPoints, { color: selTier.text }]}>
                    ⭐ {sel.points} poäng
                  </Text>
                  {sel.bonus_points ? (
                    <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                      ✨ Bonus +{sel.bonus_points}p: {sel.bonus_condition}
                    </Text>
                  ) : null}
                  {sel.requires_alcohol ? (
                    <Text style={styles.alcoholNote}>
                      🔞 Alkoholfritt alternativ gäller alltid — drick ansvarsfullt, aldrig under 18.
                    </Text>
                  ) : null}

                  {selCompletion?.status === "confirmed" ? (
                    <View style={styles.doneRow}>
                      <Text style={[styles.bigPoints, { color: "#8a1f1f" }]}>
                        Klarad — +{selCompletion.points_awarded}p
                      </Text>
                    </View>
                  ) : selCompletion?.status === "pending" ? (
                    <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                      ⏳ Väntar på vittnets bekräftelse…
                    </Text>
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
                            <Pressable onPress={takeProofPhoto} style={styles.pickChip}>
                              <Text style={styles.pickChipText}>📷 Ta foto</Text>
                            </Pressable>
                            <Pressable onPress={pickProofFromLibrary} style={styles.pickChip}>
                              <Text style={styles.pickChipText}>🖼 Välj bild/video</Text>
                            </Pressable>
                          </View>
                          {proof ? (
                            proof.video ? (
                              <Text style={[styles.bigBonus, { color: selTier.frameDark }]}>
                                🎬 Video vald — bifogas när du skickar.
                              </Text>
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
                          {sending ? "Laddar upp bevis…" : "Skicka till vittnet 🕯"}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#171022" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: "#e9dcb8", fontSize: 19, fontWeight: "800", fontFamily: SERIF },
  top: { paddingHorizontal: 16, gap: 10, paddingBottom: 12 },
  progressCard: {
    backgroundColor: "rgba(233,220,184,0.08)",
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.35)",
  },
  progressBig: { color: "#e9dcb8", fontSize: 20, fontWeight: "800", fontFamily: SERIF },
  progressDim: { color: "#b9a97f", fontSize: 13 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: { height: 8, backgroundColor: "#d4af37" },
  witnessBox: {
    backgroundColor: "rgba(212,175,55,0.12)",
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#d4af37",
  },
  witnessTitle: { color: "#e9dcb8", fontWeight: "800", fontSize: 15, fontFamily: SERIF },
  witnessRow: { gap: 8 },
  witnessText: { color: "#e9dcb8", fontSize: 14 },
  witnessNoProof: { color: "#b9a97f", fontSize: 12, fontStyle: "italic" },
  proofThumb: { width: 120, height: 120, borderRadius: 10, backgroundColor: "#000" },
  proofVideoBtn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  proofPreview: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    backgroundColor: "#000",
  },
  confirmBtn: {
    backgroundColor: "#15803d",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  denyBtn: {
    backgroundColor: "#b91c1c",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterChipOn: { borderColor: "#d4af37", backgroundColor: "rgba(212,175,55,0.2)" },
  filterText: { color: "#e9dcb8", fontWeight: "700", fontSize: 13 },

  cardBack: {
    aspectRatio: 0.68,
    borderRadius: 10,
    borderWidth: 3,
    padding: 4,
    overflow: "hidden",
  },
  cardInnerFrame: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    gap: 4,
  },
  cornerSymbol: { position: "absolute", top: 3, left: 5, fontSize: 12 },
  cornerCategory: { position: "absolute", top: 3, right: 5, fontSize: 11 },
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
    borderColor: "#9b1c1c",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    transform: [{ rotate: "-18deg" }],
    backgroundColor: "rgba(155,28,28,0.12)",
  },
  stampSmall: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 2 },
  stampText: { color: "#9b1c1c", fontWeight: "900", fontSize: 20, letterSpacing: 2 },

  modalDim: { flex: 1, backgroundColor: "rgba(10,6,18,0.92)" },
  modalScroll: { padding: 20, paddingTop: 48, alignItems: "center", gap: 14, paddingBottom: 60 },
  bigCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 5,
    padding: 8,
    overflow: "hidden",
  },
  bigInnerFrame: { borderWidth: 1.5, borderRadius: 12, padding: 16, gap: 10 },
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
  alcoholNote: { color: "#8a5a10", fontSize: 12, textAlign: "center", fontWeight: "600" },
  doneRow: { alignItems: "center" },
  claimBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  claimBox: { gap: 10 },
  claimLabel: { fontSize: 14, fontWeight: "700", fontFamily: SERIF },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pickChip: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.15)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pickChipOn: { borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,0.25)" },
  pickChipText: { color: "#2b2013", fontWeight: "700", fontSize: 13 },
  bonusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  error: { color: "#b91c1c", fontSize: 13, textAlign: "center" },
  themeCaption: { fontSize: 11, fontStyle: "italic", textAlign: "center", marginTop: 4 },
  closeBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
});
