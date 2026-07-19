import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { ACTIVATION_KINDS, ACTIVATION_KIND_OPTIONS } from "@/lib/activation";
import { supabase } from "@/lib/supabase";
import type { ActivationActivity, ActivationKind } from "@/lib/types";
import { useColors } from "@/lib/ui";
import { useIsAdmin } from "@/lib/useIsAdmin";

export default function AdminActivationsScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const isAdmin = useIsAdmin();

  const [rows, setRows] = useState<ActivationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<ActivationKind>("thumb_order");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [windowHours, setWindowHours] = useState("24");

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  }, [router]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("activation_activities")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as ActivationActivity[]);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  async function createActivity() {
    const n = name.trim();
    if (!n || !userId || busy) return;
    const hours = Math.min(168, Math.max(1, parseInt(windowHours, 10) || 24));
    setBusy(true);
    await supabase.from("activation_activities").insert({
      kind,
      name: n,
      description: description.trim() || null,
      window_hours: hours,
      created_by: userId,
    });
    setBusy(false);
    setName("");
    setDescription("");
    void load();
  }

  async function toggleActive(a: ActivationActivity) {
    await supabase
      .from("activation_activities")
      .update({ is_active: !a.is_active })
      .eq("id", a.id);
    void load();
  }

  async function remove(a: ActivationActivity) {
    await supabase.from("activation_activities").delete().eq("id", a.id);
    void load();
  }

  function confirmRemove(a: ActivationActivity) {
    const message = `Radera "${a.name}"? Den slumpas inte längre fram till tysta chattar.`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void remove(a);
      return;
    }
    Alert.alert("Radera aktivitet", message, [
      { text: "Avbryt", style: "cancel" },
      { text: "Radera", style: "destructive", onPress: () => void remove(a) },
    ]);
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
        <Text style={[styles.title, { color: c.text }]}>Aktivera chattar</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.hint, { color: c.textSecondary }]}>
            När en chatt varit tyst i 48h slumpas en av de aktiva aktiviteterna fram
            för att väcka liv i gruppen och dela ut poäng.
          </Text>

          <Text style={[styles.sectionTitle, { color: c.text }]}>Ny aktivitet</Text>
          <View style={styles.kindRow}>
            {ACTIVATION_KIND_OPTIONS.map((k) => {
              const active = kind === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[
                    styles.kindChip,
                    { borderColor: c.backgroundSelected },
                    active ? { backgroundColor: c.brand, borderColor: c.brand } : null,
                  ]}
                >
                  <Text style={[styles.kindChipText, { color: active ? "#fff" : c.text }]}>
                    {ACTIVATION_KINDS[k].emoji} {ACTIVATION_KINDS[k].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.kindBlurb, { color: c.textSecondary }]}>
            {ACTIVATION_KINDS[kind].blurb}
          </Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Namn (visas i chatten)…"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Beskrivning (valfritt)…"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
          />
          <View style={styles.durationRow}>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>Svarstid (timmar)</Text>
            <TextInput
              value={windowHours}
              onChangeText={setWindowHours}
              keyboardType="number-pad"
              style={[
                styles.durationInput,
                { color: c.text, borderColor: c.backgroundSelected },
              ]}
            />
          </View>

          <Pressable
            onPress={createActivity}
            disabled={busy || !name.trim()}
            style={[
              styles.addBtn,
              { backgroundColor: c.brand, opacity: busy || !name.trim() ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.addBtnText}>+ Lägg till aktivitet</Text>
          </Pressable>

          <Text style={[styles.sectionTitle, { color: c.text }]}>Aktiviteter</Text>
          {rows.length === 0 ? (
            <Text style={{ color: c.textSecondary, marginTop: 8 }}>
              Inga aktiviteter än. Lägg till minst en för att slå på funktionen.
            </Text>
          ) : (
            rows.map((a) => (
              <View key={a.id} style={[styles.card, { backgroundColor: c.backgroundElement }]}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                    {ACTIVATION_KINDS[a.kind]?.emoji} {a.name}
                  </Text>
                  <Switch value={a.is_active} onValueChange={() => toggleActive(a)} />
                </View>
                {a.description ? (
                  <Text style={[styles.cardDesc, { color: c.textSecondary }]}>
                    {a.description}
                  </Text>
                ) : null}
                <View style={styles.cardFooter}>
                  <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                    {ACTIVATION_KINDS[a.kind]?.label} · {a.window_hours}h svarstid ·{" "}
                    {a.is_active ? "Aktiv" : "Pausad"}
                  </Text>
                  <Pressable onPress={() => confirmRemove(a)} hitSlop={6}>
                    <Text style={{ color: c.danger, fontWeight: "700", fontSize: 13 }}>
                      Radera
                    </Text>
                  </Pressable>
                </View>
              </View>
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
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  hint: { fontSize: 13, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  kindRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  kindChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  kindChipText: { fontSize: 13, fontWeight: "600" },
  kindBlurb: { fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 10,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  durationInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    width: 90,
    textAlign: "center",
  },
  addBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  addBtnText: { color: "#fff", fontWeight: "700" },
  card: { borderRadius: 16, padding: 16, marginTop: 12, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: "800" },
  cardDesc: { fontSize: 13 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
