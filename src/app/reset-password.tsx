import { useRouter } from "expo-router";
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

import { useAuth } from "@/lib/auth";
import { svAuthError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { useColors } from "@/lib/ui";

/**
 * Landningssida för återställningslänken i mejlet. Supabase läser
 * recovery-tokenen ur URL:en (detectSessionInUrl på web) och skapar en
 * session — här väljer användaren sedan sitt nya lösenord själv.
 */
export default function ResetPasswordScreen() {
  const c = useColors();
  const router = useRouter();
  const { session } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    if (password.length < 6) {
      setError("Lösenordet måste vara minst 6 tecken.");
      return;
    }
    if (password !== confirm) {
      setError("Lösenorden matchar inte.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(svAuthError(updateError.message));
      return;
    }
    setDone(true);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Logo size={38} />
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Välj ett nytt lösenord
          </Text>

          {done ? (
            <>
              <Text style={styles.notice}>Lösenordet är bytt!</Text>
              <Pressable
                onPress={() => router.replace("/groups")}
                style={[styles.button, { backgroundColor: c.brand }]}
              >
                <Text style={styles.buttonText}>Till appen</Text>
              </Pressable>
            </>
          ) : !session ? (
            <Text style={{ color: c.textSecondary, textAlign: "center" }}>
              Länken är ogiltig eller har gått ut. Begär en ny från{" "}
              <Text
                style={{ color: c.brand, fontWeight: "600" }}
                onPress={() => router.replace("/forgot-password")}
              >
                Glömt lösenord
              </Text>
              .
            </Text>
          ) : (
            <>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Nytt lösenord"
                placeholderTextColor={c.textSecondary}
                secureTextEntry
                autoComplete="new-password"
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
              />
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Upprepa lösenordet"
                placeholderTextColor={c.textSecondary}
                secureTextEntry
                autoComplete="new-password"
                style={[styles.input, { color: c.text, borderColor: c.backgroundSelected }]}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={submit}
                disabled={busy}
                style={[styles.button, { backgroundColor: c.brand, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={styles.buttonText}>{busy ? "Sparar…" : "Byt lösenord"}</Text>
              </Pressable>
            </>
          )}
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
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: { borderRadius: 8, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: "#FF4C29", fontSize: 14 },
  notice: { color: "#00B884", fontSize: 15, textAlign: "center", fontWeight: "600" },
});
