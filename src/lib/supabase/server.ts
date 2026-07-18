import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase-klient för server-komponenter, server actions och route handlers. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Kan kasta i server-komponenter (read-only cookies) – middleware
          // sköter sessionsuppdateringen, så vi kan ignorera felet här.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // no-op
          }
        },
      },
    },
  );
}
