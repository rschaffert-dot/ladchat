import { signOutAction } from "@/app/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-sm font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
      >
        Logga ut
      </button>
    </form>
  );
}
