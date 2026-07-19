import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { AuthProvider, useAuth } from "@/lib/auth";
import { PENDING_INVITE_KEY } from "@/lib/invite";

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    const isAuthScreen = first === "login" || first === "register";
    const isJoinScreen = first === "join";

    if (!session && !isAuthScreen && !isJoinScreen) {
      router.replace("/login");
      return;
    }
    if (session && isAuthScreen) {
      AsyncStorage.getItem(PENDING_INVITE_KEY).then((token) => {
        if (token) {
          router.replace({ pathname: "/join/[token]", params: { token } });
        } else {
          router.replace("/groups");
        }
      });
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
  );
}
