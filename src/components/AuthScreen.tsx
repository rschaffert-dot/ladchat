import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NEEDS_AVATAR_KEY } from "@/lib/avatar";
import { svAuthError } from "@/lib/errors";
import { signInWithGoogle } from "@/lib/oauth";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/ui";

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const c = useColors();
  const isLogin = mode === "login";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
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
    if (!isLogin) {
      if (!firstName.trim() || !lastName.trim()) {
        setError("Fyll i för- och efternamn.");
        return;
      }
      if (!phone.trim()) {
        setError("Fyll i telefonnummer.");
        return;
      }
      if (password.length < 6) {
        setError("Lösenordet måste vara minst 6 tecken.");
        return;
      }
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
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone.trim(),
          },
        },
      });
      if (signUpError) {
        setBusy(false);
        setError(svAuthError(signUpError.message));
        return;
      }
      // Nyregistrerad → visa avatar-steget efter inloggning.
      await AsyncStorage.setItem(NEEDS_AVATAR_KEY, "1");
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

  async function google() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(svAuthError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [styles.input, { color: c.text, borderColor: c.backgroundSelected }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.brand, { color: c.text }]}>Ladchat</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {isLogin ? "Logga in för att fortsätta" : "Skapa ett konto"}
          </Text>

          <Pressable
            onPress={google}
            disabled={busy}
            style={[
              styles.googleBtn,
              { borderColor: c.backgroundSelected, opacity: busy ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.googleText, { color: c.text }]}>
              Fortsätt med Google
            </Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: c.backgroundSelected }]} />
            <Text style={{ color: c.textSecondary, fontSize: 12 }}>eller</Text>
            <View style={[styles.divider, { backgroundColor: c.backgroundSelected }]} />
          </View>

          {!isLogin ? (
            <>
              <View style={styles.nameRow}>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Förnamn"
                  placeholderTextColor={c.textSecondary}
                  autoComplete="name-given"
                  style={[inputStyle, styles.flex]}
                />
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Efternamn"
                  placeholderTextColor={c.textSecondary}
                  autoComplete="name-family"
                  style={[inputStyle, styles.flex]}
                />
              </View>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Telefonnummer"
                placeholderTextColor={c.textSecondary}
                keyboardType="phone-pad"
                autoComplete="tel"
                style={inputStyle}
              />
            </>
          ) : null}

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="E-post"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={inputStyle}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Lösenord"
            placeholderTextColor={c.textSecondary}
            secureTextEntry
            autoComplete={isLogin ? "current-password" : "new-password"}
            style={inputStyle}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  brand: { fontSize: 32, fontWeight: "800", textAlign: "center" },
  subtitle: { textAlign: "center", marginBottom: 12 },
  googleBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  googleText: { fontSize: 16, fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  nameRow: { flexDirection: "row", gap: 10 },
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
