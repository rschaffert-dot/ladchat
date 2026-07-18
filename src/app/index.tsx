import { Redirect } from "expo-router";

// Auth-gating i _layout skickar vidare till /login om man inte är inloggad.
export default function Index() {
  return <Redirect href="/groups" />;
}
