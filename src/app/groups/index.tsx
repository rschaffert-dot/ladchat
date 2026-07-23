import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { SkeletonListRow } from "@/components/Skeleton";

import { useAuth } from "@/lib/auth";
import {
  CURRENCY_OPTIONS,
  DEFAULT_CHAT_SETTINGS,
  saveChatSettings,
} from "@/lib/chatSettings";
import type { Currency } from "@/lib/chatSettings";
import { supabase } from "@/lib/supabase";
import type { Group } from "@/lib/types";
import { useColors } from "@/lib/ui";
import { useIsAdmin } from "@/lib/useIsAdmin";

export default function GroupsScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const isAdmin = useIsAdmin();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState<Currency>(CURRENCY_OPTIONS[0]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [unread, setUnread] = useState<Record<string, number>>({});
  const [teamScores, setTeamScores] = useState<
    Record<string, { member: number; team: number; total: number }>
  >({});
  // Chattlistans Messenger-manér: sök, nålat/mute/arkiv per medlemskap.
  const [search, setSearch] = useState("");
  const [prefs, setPrefs] = useState<
    Record<string, { pinnedAt: string | null; muted: boolean; archived: boolean }>
  >({});
  const [showArchived, setShowArchived] = useState(false);
  const [previews, setPreviews] = useState<Record<string, { text: string; at: string }>>({});

  const load = useCallback(async () => {
    if (!userId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    // Bara grupper användaren faktiskt är medlem i. (RLS tillåter läsning av
    // gruppnamn för turneringsdeltagare pga den offentliga topplistan, så vi
    // måste filtrera på medlemskap här — annars syns alla turneringsgrupper.)
    const { data } = await supabase
      .from("groups")
      .select(
        "id,name,owner_id,created_at,msg_streak,msg_streak_date,group_members!inner(user_id,pinned_at,muted,archived)",
      )
      .eq("group_members.user_id", userId)
      .order("created_at", { ascending: false });
    type Row = Group & {
      group_members: { user_id: string; pinned_at: string | null; muted: boolean; archived: boolean }[];
    };
    const rows = (data ?? []) as Row[];
    setPrefs(
      Object.fromEntries(
        rows.map((g) => {
          const gm = g.group_members[0];
          return [
            g.id,
            {
              pinnedAt: gm?.pinned_at ?? null,
              muted: gm?.muted ?? false,
              archived: gm?.archived ?? false,
            },
          ];
        }),
      ),
    );
    const myGroups = rows.map(({ group_members: _gm, ...g }) => g);
    setGroups(myGroups);
    setLoading(false);

    if (myGroups.length > 0) {
      // Förhandsvisning: senaste meddelandet per grupp ur en gemensam batch.
      const { data: recent } = await supabase
        .from("messages")
        .select("group_id, content, created_at")
        .in("group_id", myGroups.map((g) => g.id))
        .order("created_at", { ascending: false })
        .limit(80);
      const pv: Record<string, { text: string; at: string }> = {};
      for (const m of recent ?? []) {
        const gid = m.group_id as string;
        if (!pv[gid]) pv[gid] = { text: m.content as string, at: m.created_at as string };
      }
      setPreviews(pv);

      const { data: scores } = await supabase
        .from("group_scores")
        .select("group_id, member_points, team_points, total_points")
        .in("group_id", myGroups.map((g) => g.id));
      setTeamScores(
        Object.fromEntries(
          (scores ?? []).map((s) => [
            s.group_id as string,
            {
              member: s.member_points as number,
              team: s.team_points as number,
              total: s.total_points as number,
            },
          ]),
        ),
      );
    }

    if (userId) {
      const { data: notes } = await supabase
        .from("notifications")
        .select("group_id")
        .eq("user_id", userId)
        .eq("read", false);
      const counts: Record<string, number> = {};
      for (const n of notes ?? []) {
        counts[n.group_id as string] = (counts[n.group_id as string] ?? 0) + 1;
      }
      setUnread(counts);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function createGroup() {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_group", {
      group_name: n,
    });
    setCreating(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const newGroupId = data as string;
    await saveChatSettings(newGroupId, { ...DEFAULT_CHAT_SETTINGS, currency });
    setName("");
    router.push({ pathname: "/groups/[id]", params: { id: newGroupId } });
  }

  async function joinGroup() {
    const t = code.trim();
    if (!t || joining) return;
    setJoining(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("accept_invite", {
      invite_token: t,
    });
    setJoining(false);
    if (rpcError || !data) {
      setError("Ogiltig inbjudningskod.");
      return;
    }
    setCode("");
    router.push({ pathname: "/groups/[id]", params: { id: data as string } });
  }

  async function setPref(gid: string, patch: { pin?: boolean; mute?: boolean; arch?: boolean }) {
    await supabase.rpc("set_chat_prefs", {
      gid,
      pin: patch.pin ?? null,
      mute: patch.mute ?? null,
      arch: patch.arch ?? null,
    });
    await load();
  }

  async function markGroupRead(gid: string) {
    if (!userId) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("group_id", gid)
      .eq("read", false);
    await load();
  }

  function relTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "nu";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
    return `${Math.floor(diff / 86_400_000)} d`;
  }

  // Sortering: nålade först, sedan senast skapade. Arkiverade göms bakom knappen.
  const q = search.trim().toLowerCase();
  const visible = groups
    .filter((g) => (q ? g.name.toLowerCase().includes(q) : true))
    .filter((g) => (showArchived ? true : !prefs[g.id]?.archived))
    .sort((a, b) => {
      const pa = prefs[a.id]?.pinnedAt;
      const pb = prefs[b.id]?.pinnedAt;
      if (!!pa !== !!pb) return pa ? -1 : 1;
      if (pa && pb) return pb.localeCompare(pa);
      return b.created_at.localeCompare(a.created_at);
    });
  const archivedCount = groups.filter((g) => prefs[g.id]?.archived).length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>Dina grupper</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push("/profile")} hitSlop={8}>
            <Text style={{ fontSize: 18 }}>👤</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/feed")} hitSlop={8}>
            <Text style={{ color: c.brand, fontWeight: "700" }}>Utforska</Text>
          </Pressable>
          {isAdmin ? (
            <Pressable onPress={() => router.push("/admin")} hitSlop={8}>
              <Text style={{ color: c.textSecondary, fontWeight: "600" }}>⚙️</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
            <Text style={{ color: c.textSecondary, fontWeight: "600" }}>
              Logga ut
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.forms}>
        <View style={styles.row}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Namn på ny grupp…"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <Pressable
            onPress={createGroup}
            disabled={creating}
            style={[styles.btn, { backgroundColor: c.brand, opacity: creating ? 0.6 : 1 }]}
          >
            <Text style={styles.btnText}>Skapa</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Gå med med inbjudningskod…"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <Pressable
            onPress={joinGroup}
            disabled={joining}
            style={[styles.btn, { backgroundColor: c.backgroundSelected, opacity: joining ? 0.6 : 1 }]}
          >
            <Text style={[styles.btnText, { color: c.text }]}>Gå med</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="🔍 Sök bland dina chattar…"
          placeholderTextColor={c.textSecondary}
          style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
        />
      </View>

      {loading ? (
        <View style={{ paddingTop: 12 }}>
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              {q
                ? "Inga chattar matchar sökningen."
                : "Du är inte med i någon grupp än. Skapa en ovan!"}
            </Text>
          }
          ListFooterComponent={
            archivedCount > 0 ? (
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                style={styles.archiveToggle}
              >
                <Text style={{ color: c.textSecondary, fontWeight: "600", fontSize: 13 }}>
                  🗄 {showArchived ? "Dölj arkiverade" : `Visa arkiverade (${archivedCount})`}
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const p = prefs[item.id];
            return (
              <Swipeable
                friction={2}
                overshootLeft={false}
                overshootRight={false}
                renderLeftActions={() => (
                  <View style={styles.swipeActions}>
                    <Pressable
                      onPress={() => void setPref(item.id, { pin: !p?.pinnedAt })}
                      style={[styles.swipeBtn, { backgroundColor: "#2563eb" }]}
                    >
                      <Text style={styles.swipeBtnText}>
                        📌 {p?.pinnedAt ? "Lossa" : "Nåla"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void markGroupRead(item.id)}
                      style={[styles.swipeBtn, { backgroundColor: "#16a34a" }]}
                    >
                      <Text style={styles.swipeBtnText}>✓ Läst</Text>
                    </Pressable>
                  </View>
                )}
                renderRightActions={() => (
                  <View style={styles.swipeActions}>
                    <Pressable
                      onPress={() => void setPref(item.id, { mute: !p?.muted })}
                      style={[styles.swipeBtn, { backgroundColor: "#6b7280" }]}
                    >
                      <Text style={styles.swipeBtnText}>
                        {p?.muted ? "🔔 Ljud på" : "🔕 Ljudlös"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void setPref(item.id, { arch: !p?.archived })}
                      style={[styles.swipeBtn, { backgroundColor: "#b45309" }]}
                    >
                      <Text style={styles.swipeBtnText}>
                        🗄 {p?.archived ? "Återställ" : "Arkivera"}
                      </Text>
                    </Pressable>
                  </View>
                )}
              >
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/groups/[id]", params: { id: item.id } })
                  }
                  style={[
                    styles.groupItem,
                    { backgroundColor: c.backgroundElement },
                    p?.archived ? { opacity: 0.55 } : null,
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.groupNameRow}>
                      {p?.pinnedAt ? <Text style={{ fontSize: 12 }}>📌</Text> : null}
                      <Text style={[styles.groupName, { color: c.text }]}>{item.name}</Text>
                      {(item.msg_streak ?? 0) > 1 ? (
                        <Text style={{ fontSize: 12, color: c.textSecondary }}>
                          🔥{item.msg_streak}
                          {item.msg_streak_date !== new Date().toISOString().slice(0, 10)
                            ? "⌛"
                            : ""}
                        </Text>
                      ) : null}
                      {p?.muted ? <Text style={{ fontSize: 12 }}>🔕</Text> : null}
                      {unread[item.id] && !p?.muted ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{unread[item.id]}</Text>
                        </View>
                      ) : null}
                    </View>
                    {previews[item.id] ? (
                      <Text
                        style={{ color: c.textSecondary, fontSize: 13 }}
                        numberOfLines={1}
                      >
                        {previews[item.id].text}
                      </Text>
                    ) : null}
                    {teamScores[item.id] ? (
                      <Text style={{ color: c.textSecondary, fontSize: 11 }}>
                        🛡 {teamScores[item.id].total} teampoäng
                        {previews[item.id] ? ` · ${relTime(previews[item.id].at)}` : ""}
                      </Text>
                    ) : null}
                  </View>
                  {item.owner_id === userId ? (
                    <Text style={[styles.ownerTag, { color: c.brand }]}>Ägare</Text>
                  ) : (
                    <Text style={{ color: c.textSecondary }}>›</Text>
                  )}
                </Pressable>
              </Swipeable>
            );
          }}
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
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: "800" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  forms: { paddingHorizontal: 20, gap: 10, paddingBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  currencyRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  btn: {
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  error: { color: "#dc2626", fontSize: 14 },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  empty: { textAlign: "center", marginTop: 40 },
  groupItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  groupName: { fontSize: 16, fontWeight: "600" },
  groupNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    backgroundColor: "#dc2626",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  swipeActions: { flexDirection: "row" },
  swipeBtn: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    minWidth: 84,
  },
  swipeBtnText: { color: "#fff", fontWeight: "700", fontSize: 12, textAlign: "center" },
  archiveToggle: { alignItems: "center", paddingVertical: 14 },
  ownerTag: { fontSize: 12, fontWeight: "700" },
});
