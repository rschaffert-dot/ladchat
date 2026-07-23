import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

export type OAuthProvider = "google" | "apple" | "facebook";

/**
 * Loggar in med en OAuth-leverantör. På web sker det via redirect
 * (Supabase slutför sessionen när användaren kommer tillbaka). På
 * native öppnar vi ett auth-fönster och byter koden/token mot session.
 *
 * Kräver att respektive provider är konfigurerad i Supabase-dashboarden
 * (Authentication → Providers) — annars ger anropet ett fel.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const redirectTo =
    Platform.OS === "web"
      ? typeof window !== "undefined"
        ? window.location.origin
        : undefined
      : Linking.createURL("/");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: Platform.OS !== "web" },
  });
  if (error) throw error;

  // Web: webbläsaren navigerar till Google och tillbaka automatiskt.
  if (Platform.OS === "web" || !data?.url) return;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success" || !result.url) return;

  const url = result.url;
  const fragment = url.split("#")[1] ?? url.split("?")[1] ?? "";
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const code = params.get("code");

  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
  } else if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }
}

export const signInWithGoogle = () => signInWithProvider("google");
export const signInWithApple = () => signInWithProvider("apple");
export const signInWithFacebook = () => signInWithProvider("facebook");
