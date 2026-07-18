import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  // Middleware har redan säkrat att användaren är inloggad här.
  const { data, error } = await supabase.rpc("accept_invite", {
    invite_token: token,
  });

  if (!error && data) {
    redirect(`/groups/${data as string}`);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold">Ogiltig inbjudan</h1>
      <p className="mt-2 text-sm opacity-60">
        Länken är felaktig eller har upphört att gälla.
      </p>
      <Link
        href="/groups"
        className="mt-6 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Till dina grupper
      </Link>
    </div>
  );
}
