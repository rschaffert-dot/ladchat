/** Översätt vanliga Supabase-auth-fel till svenska. */
export function svAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Fel e-post eller lösenord.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "E-postadressen är redan registrerad.";
  if (m.includes("password should be at least"))
    return "Lösenordet måste vara minst 6 tecken.";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "Ogiltig e-postadress.";
  if (m.includes("email not confirmed"))
    return "Bekräfta din e-post innan du loggar in.";
  return msg;
}
