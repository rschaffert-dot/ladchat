"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "@/app/auth/actions";

type Props = {
  mode: "login" | "register";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
};

export function AuthForm({ mode, action, next }: Props) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );
  const isLogin = mode === "login";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Ladchat</h1>
        <p className="mt-1 text-sm opacity-60">
          {isLogin ? "Logga in för att fortsätta" : "Skapa ett konto"}
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          E-post
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-base outline-none focus:border-[var(--brand)] dark:border-white/15 dark:bg-white/5"
            placeholder="du@example.com"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Lösenord
          <input
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={6}
            className="rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-base outline-none focus:border-[var(--brand)] dark:border-white/15 dark:bg-white/5"
            placeholder="Minst 6 tecken"
          />
        </label>

        {next ? <input type="hidden" name="next" value={next} /> : null}

        {state.error ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-xl bg-[var(--brand)] px-4 py-3 text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
        >
          {pending ? "…" : isLogin ? "Logga in" : "Skapa konto"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm opacity-70">
        {isLogin ? (
          <>
            Har du inget konto?{" "}
            <Link href="/register" className="font-semibold text-[var(--brand)]">
              Registrera dig
            </Link>
          </>
        ) : (
          <>
            Har du redan ett konto?{" "}
            <Link href="/login" className="font-semibold text-[var(--brand)]">
              Logga in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
