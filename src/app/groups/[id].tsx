import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Group, Message, MessageWithAuthor } from "@/lib/types";
import { useColors } from "@/lib/ui";

const PAGE = 30;
const MISSING = "00000000-0000-0000-0000-000000000000";

export default function GroupChatScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();

  const [group, setGroup] = useState<Group | null>(null);
  // Meddelanden i fallande ordning (nyast först) för inverterad lista.
  const [messages, setMessages] = useState<MessageWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const namesRef = useRef<Record<string, string>>({});

  const nameFor = useCallback(async (uid: string): Promise<string> => {
    if (namesRef.current[uid]) return namesRef.current[uid];
    const { data } = await supabase
      .from("profiles")
      .select("display_name,email")
      .eq("id", uid)
      .single();
    const n = data?.display_name || data?.email || "Okänd";
    namesRef.current[uid] = n;
    return n;
  }, []);

  // Initial laddning.
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    (async () => {
      const { data: g } = await supabase
        .from("groups")
        .select("id,name,owner_id,created_at")
        .eq("id", groupId)
        .single();
      if (!active) return;
      if (!g) {
        router.back();
        return;
      }
      setGroup(g as Group);

      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId);
      const ids = (members ?? []).map((m) => m.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name,email")
        .in("id", ids.length ? ids : [MISSING]);
      (profs ?? []).forEach((p) => {
        namesRef.current[p.id] = p.display_name || p.email || "Okänd";
      });

      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (!active) return;
      const list = ((msgs ?? []) as Message[]).map((m) => ({
        ...m,
        author_name: namesRef.current[m.user_id] ?? "Okänd",
      }));
      setMessages(list);
      setHasMore((msgs?.length ?? 0) >= PAGE);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [groupId, router]);

  // Realtime.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [
                  { ...m, author_name: namesRef.current[m.user_id] ?? "…" },
                  ...prev,
                ],
          );
          if (!namesRef.current[m.user_id]) {
            void nameFor(m.user_id).then((n) =>
              setMessages((prev) =>
                prev.map((x) =>
                  x.id === m.id ? { ...x, author_name: n } : x,
                ),
              ),
            );
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, nameFor]);

  async function send() {
    const content = text.trim();
    if (!content || sending || !userId || !groupId) return;
    setSending(true);
    const { error } = await supabase
      .from("messages")
      .insert({ group_id: groupId, user_id: userId, content });
    setSending(false);
    if (!error) setText("");
  }

  async function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[messages.length - 1].created_at;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const older = await Promise.all(
      ((data ?? []) as Message[]).map(async (m) => ({
        ...m,
        author_name: await nameFor(m.user_id),
      })),
    );
    setMessages((prev) => [...prev, ...older]);
    setHasMore((data?.length ?? 0) >= PAGE);
    setLoadingOlder(false);
  }

  async function invite() {
    if (!groupId || !userId) return;
    const { data, error } = await supabase
      .from("group_invites")
      .insert({ group_id: groupId, created_by: userId })
      .select("token")
      .single();
    if (error || !data) return;
    await Share.share({
      message: `Gå med i "${group?.name ?? "gruppen"}" på Ladchat med koden:\n\n${data.token}`,
    });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.backgroundElement }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
          {group?.name ?? ""}
        </Text>
        <Pressable onPress={invite} hitSlop={8}>
          <Text style={{ color: c.brand, fontWeight: "700" }}>Bjud in</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.listContent}
            onEndReached={hasMore ? loadOlder : undefined}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingOlder ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null
            }
            ListEmptyComponent={
              <Text style={[styles.empty, { color: c.textSecondary }]}>
                Inga meddelanden än. Skriv det första!
              </Text>
            }
            renderItem={({ item }) => {
              const mine = item.user_id === userId;
              return (
                <View style={[styles.msgRow, mine ? styles.mine : styles.theirs]}>
                  {!mine ? (
                    <Text style={[styles.author, { color: c.textSecondary }]}>
                      {item.author_name}
                    </Text>
                  ) : null}
                  <View
                    style={[
                      styles.bubble,
                      mine
                        ? { backgroundColor: c.brand, borderBottomRightRadius: 4 }
                        : {
                            backgroundColor: c.backgroundElement,
                            borderBottomLeftRadius: 4,
                          },
                    ]}
                  >
                    <Text style={{ color: mine ? "#fff" : c.text, fontSize: 15 }}>
                      {item.content}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={[styles.inputBar, { borderTopColor: c.backgroundElement }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Skriv ett meddelande…"
            placeholderTextColor={c.textSecondary}
            multiline
            style={[
              styles.input,
              { color: c.text, borderColor: c.backgroundSelected },
            ]}
          />
          <Pressable
            onPress={send}
            disabled={sending || text.trim().length === 0}
            style={[
              styles.sendBtn,
              {
                backgroundColor: c.brand,
                opacity: sending || text.trim().length === 0 ? 0.4 : 1,
              },
            ]}
          >
            <Text style={styles.sendText}>Skicka</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { paddingHorizontal: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  listContent: { padding: 12, gap: 8 },
  empty: { textAlign: "center", marginTop: 40, transform: [{ scaleY: -1 }] },
  msgRow: { maxWidth: "82%" },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  author: { fontSize: 12, marginBottom: 2, marginLeft: 6 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontWeight: "700" },
});
