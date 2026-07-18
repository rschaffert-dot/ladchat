"use client";

import { useActionState } from "react";
import { createGroupAction, type GroupFormState } from "@/app/groups/actions";

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState<GroupFormState, FormData>(
    createGroupAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Namn på ny grupp…"
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-4 py-3 text-base outline-none focus:border-[var(--brand)] dark:border-white/15 dark:bg-white/5"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl bg-[var(--brand)] px-4 py-3 text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
        >
          {pending ? "…" : "Skapa"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
    </form>
  );
}
