import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { NEEDS_AVATAR_KEY } from "@/lib/avatar";
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
    // Lösenordsåterställning måste nås utan session (mejllänken skapar en
    // recovery-session först när sidan laddats) och får inte auto-omdirigeras
    // till /groups när sessionen sätts — användaren ska hinna byta lösenord.
    const isPasswordScreen = first === "forgot-password" || first === "reset-password";
    const isJoinScreen = first === "join";
    if (isPasswordScreen) return;

    if (!session && !isAuthScreen && !isJoinScreen) {
      router.replace("/login");
      return;
    }
    if (session && isAuthScreen) {
      Promise.all([
        AsyncStorage.getItem(PENDING_INVITE_KEY),
        AsyncStorage.getItem(NEEDS_AVATAR_KEY),
      ]).then(([token, needsAvatar]) => {
        if (token) {
          router.replace({ pathname: "/join/[token]", params: { token } });
        } else if (needsAvatar) {
          router.replace("/onboarding/avatar");
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

  // fullScreenGestureEnabled: svep tillbaka från vänsterkant på hela ytan (iOS).
  return <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true }} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
    </GestureHandlerRootView>
  );
}
