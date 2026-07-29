import { Link } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { svAuthError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/ui";

/** Skickar ett återställningsmail; länken tar användaren till /reset-password. */
export default function ForgotPasswordScreen() {
  const c = useColors();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true);
    setError(null);
    const redirectTo =
      Platform.OS === "web" && typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(e, {
      redirectTo,
    });
    setBusy(false);
    if (resetError) {
      setError(svAuthError(resetError.message));
      return;
    }
    setSent(true);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Text style={[styles.brand, { color: c.text }]}>Ladchat</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Återställ ditt lösenord
          </Text>

          {sent ? (
            <Text style={styles.notice}>
              Klart! Kolla din inkorg — vi har mejlat en länk som låter dig välja ett nytt
              lösenord. (Titta även i skräpposten.)
            </Text>
          ) : (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="E-post"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={submit}
                disabled={busy || !email.trim()}
                style={[
                  styles.button,
                  { backgroundColor: c.brand, opacity: busy || !email.trim() ? 0.6 : 1 },
                ]}
              >
                <Text style={styles.buttonText}>
                  {busy ? "Skickar…" : "Skicka återställningslänk"}
                </Text>
              </Pressable>
            </>
          )}

          <View style={styles.switchRow}>
            <Link href="/login" replace>
              <Text style={{ color: c.brand, fontWeight: "600" }}>‹ Tillbaka till inloggning</Text>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  brand: { fontSize: 32, fontWeight: "800", textAlign: "center" },
  subtitle: { textAlign: "center", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: "#dc2626", fontSize: 14 },
  notice: { color: "#059669", fontSize: 14, textAlign: "center" },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: 12 },
});
