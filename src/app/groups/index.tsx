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
import { SafeAreaView } from "react-native-safe-area-context";

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
      .select("id,name,owner_id,created_at,group_members!inner(user_id)")
      .eq("group_members.user_id", userId)
      .order("created_at", { ascending: false });
    setGroups(
      ((data ?? []) as (Group & { group_members: unknown })[]).map(
        ({ group_members: _gm, ...g }) => g,
      ),
    );
    setLoading(false);

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

        <View style={styles.currencyRow}>
          {CURRENCY_OPTIONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setCurrency(option)}
              style={[
                styles.chip,
                { borderColor: c.backgroundSelected },
                currency === option
                  ? { backgroundColor: c.brand, borderColor: c.brand }
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: currency === option ? "#fff" : c.text },
                ]}
              >
                {option}
              </Text>
            </Pressable>
          ))}
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

        <Pressable onPress={() => router.push("/hunt")} style={styles.huntBanner}>
          <Text style={{ fontSize: 26 }}>🃏</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.huntTitle}>Poängjakten</Text>
            <Text style={styles.huntDesc}>100 utmaningar ute i verkligheten — samla korten</Text>
          </View>
          <Text style={styles.huntArrow}>›</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              Du är inte med i någon grupp än. Skapa en ovan!
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({ pathname: "/groups/[id]", params: { id: item.id } })
              }
              style={[styles.groupItem, { backgroundColor: c.backgroundElement }]}
            >
              <View style={styles.groupNameRow}>
                <Text style={[styles.groupName, { color: c.text }]}>{item.name}</Text>
                {unread[item.id] ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread[item.id]}</Text>
                  </View>
                ) : null}
              </View>
              {item.owner_id === userId ? (
                <Text style={[styles.ownerTag, { color: c.brand }]}>Ägare</Text>
              ) : (
                <Text style={{ color: c.textSecondary }}>›</Text>
              )}
            </Pressable>
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
  huntBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#221833",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#d4af37",
  },
  huntTitle: { color: "#e9dcb8", fontSize: 16, fontWeight: "800" },
  huntDesc: { color: "#b9a97f", fontSize: 12 },
  huntArrow: { color: "#e9dcb8", fontSize: 20 },
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
  ownerTag: { fontSize: 12, fontWeight: "700" },
});
