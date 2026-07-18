import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateGroupForm } from "@/components/CreateGroupForm";
import { SignOutButton } from "@/components/SignOutButton";
import type { Group } from "@/lib/types";

export default async function GroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: groups } = await supabase
    .from("groups")
    .select("id,name,owner_id,created_at")
    .order("created_at", { ascending: false });

  const list = (groups ?? []) as Group[];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/10">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dina grupper</h1>
          <p className="text-xs opacity-60">{user?.email}</p>
        </div>
        <SignOutButton />
      </header>

      <div className="px-5 py-4">
        <CreateGroupForm />
      </div>

      <main className="flex-1 px-5 pb-8">
        {list.length === 0 ? (
          <p className="mt-10 text-center text-sm opacity-60">
            Du är inte med i någon grupp än. Skapa en ovan för att komma igång!
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white/70 px-4 py-4 transition active:scale-[0.99] hover:border-[var(--brand)]/40 dark:border-white/10 dark:bg-white/5"
                >
                  <span className="font-semibold">{g.name}</span>
                  {g.owner_id === user?.id ? (
                    <span className="rounded-full bg-[var(--brand)]/10 px-2 py-0.5 text-xs font-medium text-[var(--brand)]">
                      Ägare
                    </span>
                  ) : (
                    <span className="text-xs opacity-40">›</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
