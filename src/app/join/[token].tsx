import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { PENDING_INVITE_KEY } from "@/lib/invite";
import { supabase } from "@/lib/supabase";
import { useColors } from "@/lib/ui";

export default function JoinScreen() {
  const c = useColors();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !token) return;

    if (!session) {
      AsyncStorage.setItem(PENDING_INVITE_KEY, token).finally(() => {
        router.replace("/login");
      });
      return;
    }

    let active = true;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc("accept_invite", {
        invite_token: token,
      });
      await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      if (!active) return;
      if (rpcError || !data) {
        setError("Ogiltig eller utgången inbjudningslänk.");
        return;
      }
      router.replace({ pathname: "/groups/[id]", params: { id: data as string } });
    })();
    return () => {
      active = false;
    };
  }, [authLoading, session, token, router]);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {error ? (
        <>
          <Text style={[styles.text, { color: c.text }]}>{error}</Text>
          <Pressable onPress={() => router.replace("/groups")} hitSlop={8}>
            <Text style={{ color: c.brand, fontWeight: "700", marginTop: 12 }}>
              Till dina grupper
            </Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  text: { fontSize: 15, textAlign: "center" },
});
