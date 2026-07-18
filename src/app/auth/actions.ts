"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

/** Översätt vanliga Supabase-felmeddelanden till svenska. */
function svFel(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Fel e-post eller lösenord.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "E-postadressen är redan registrerad.";
  if (m.includes("password should be at least"))
    return "Lösenordet måste vara minst 6 tecken.";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "Ogiltig e-postadress.";
  if (m.includes("email not confirmed"))
    return "Du måste bekräfta din e-post innan du kan logga in.";
  return msg;
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/groups";

  if (!email || !password) return { error: "Fyll i e-post och lösenord." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: svFel(error.message) };

  redirect(next);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Fyll i e-post och lösenord." };
  if (password.length < 6)
    return { error: "Lösenordet måste vara minst 6 tecken." };

  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ?? `http://${hdrs.get("host") ?? "localhost:3000"}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: svFel(error.message) };

  // Om e-postbekräftelse är avstängd får vi direkt en session.
  if (data.session) redirect("/groups");

  return {
    message:
      "Konto skapat! Kolla din mejl och bekräfta adressen, logga sedan in.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
