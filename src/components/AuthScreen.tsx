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

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const c = useColors();
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError("Fyll i e-post och lösenord.");
      return;
    }
    if (!isLogin && password.length < 6) {
      setError("Lösenordet måste vara minst 6 tecken.");
      return;
    }

    setBusy(true);
    if (isLogin) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (signInError) setError(svAuthError(signInError.message));
      // Vid lyckad inloggning navigerar auth-gatingen automatiskt.
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) {
        setBusy(false);
        setError(svAuthError(signUpError.message));
        return;
      }
      // E-post auto-bekräftas i databasen, så vid utebliven session loggar vi
      // in direkt för ett sömlöst flöde. (Auth-gatingen navigerar sedan.)
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        setBusy(false);
        if (signInError) {
          setNotice("Konto skapat! Bekräfta din e-post och logga sedan in.");
        }
      } else {
        setBusy(false);
      }
    }
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
            {isLogin ? "Logga in för att fortsätta" : "Skapa ett konto"}
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="E-post"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={[
              styles.input,
              { color: c.text, borderColor: c.backgroundSelected },
            ]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Lösenord"
            placeholderTextColor={c.textSecondary}
            secureTextEntry
            autoComplete={isLogin ? "current-password" : "new-password"}
            style={[
              styles.input,
              { color: c.text, borderColor: c.backgroundSelected },
            ]}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={busy}
            style={[styles.button, { backgroundColor: c.brand, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={styles.buttonText}>
              {busy ? "…" : isLogin ? "Logga in" : "Skapa konto"}
            </Text>
          </Pressable>

          <View style={styles.switchRow}>
            <Text style={{ color: c.textSecondary }}>
              {isLogin ? "Har du inget konto? " : "Har du redan ett konto? "}
            </Text>
            <Link href={isLogin ? "/register" : "/login"} replace>
              <Text style={{ color: c.brand, fontWeight: "600" }}>
                {isLogin ? "Registrera dig" : "Logga in"}
              </Text>
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
  button: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: "#dc2626", fontSize: 14 },
  notice: { color: "#059669", fontSize: 14 },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 12,
    flexWrap: "wrap",
  },
});
