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
import type { Tournament } from "@/lib/types";
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

export default function TournamentsScreen() {
  const c = useColors();
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    setTournaments((data ?? []) as Tournament[]);
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
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Text style={{ color: c.textSecondary, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: c.text }]}>Turneringar</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
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
              <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
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
              <Text style={[styles.status, { color: c.textSecondary }]}>
                {STATUS_LABELS[item.status]}
              </Text>
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
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  back: { paddingHorizontal: 4 },
  title: { fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: 20, paddingTop: 8, gap: 10, paddingBottom: 24 },
  empty: { textAlign: "center", marginTop: 40 },
  card: { borderRadius: 0, padding: 16, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: "700" },
  cardDesc: { fontSize: 13 },
  cardRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  cardMeta: { fontSize: 13, fontWeight: "600" },
  status: { fontSize: 12, marginTop: 2 },
});
