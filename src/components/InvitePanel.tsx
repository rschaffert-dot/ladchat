"use client";

import { useState } from "react";
import { createInviteAction } from "@/app/groups/actions";

export function InvitePanel({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("group_id", groupId);
    const res = await createInviteAction(fd);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.token) {
      setLink(`${window.location.origin}/invite/${res.token}`);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignorera
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!link) void generate();
        }}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--brand)] transition hover:bg-[var(--brand)]/10"
      >
        Bjud in
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-2xl border border-black/10 bg-[var(--background)] p-3 shadow-xl dark:border-white/15">
          <p className="mb-2 text-xs font-medium opacity-70">
            Dela den här länken för att bjuda in någon:
          </p>
          {loading ? (
            <p className="text-sm opacity-60">Skapar länk…</p>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : link ? (
            <div className="flex flex-col gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-black/10 bg-white/70 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-white/5"
              />
              <button
                onClick={copy}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-white"
              >
                {copied ? "Kopierad!" : "Kopiera länk"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
