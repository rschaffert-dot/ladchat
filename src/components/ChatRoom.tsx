"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, MessageWithAuthor } from "@/lib/types";

const PAGE_SIZE = 30;

type Props = {
  groupId: string;
  currentUserId: string;
  initialMessages: MessageWithAuthor[];
  initialNames: Record<string, string>;
};

export function ChatRoom({
  groupId,
  currentUserId,
  initialMessages,
  initialNames,
}: Props) {
  const supabase = useRef(createClient()).current;
  const namesRef = useRef<Record<string, string>>({ ...initialNames });

  const [messages, setMessages] = useState<MessageWithAuthor[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialMessages.length >= PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(
    initialMessages.at(-1)?.id ?? null,
  );

  const nameFor = useCallback(
    async (userId: string): Promise<string> => {
      if (namesRef.current[userId]) return namesRef.current[userId];
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", userId)
        .single();
      const name = data?.display_name || data?.email || "Okänd";
      namesRef.current[userId] = name;
      return name;
    },
    [supabase],
  );

  // Realtime: lyssna på nya meddelanden i gruppen.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [
                  ...prev,
                  { ...m, author_name: namesRef.current[m.user_id] ?? "…" },
                ],
          );
          if (!namesRef.current[m.user_id]) {
            void nameFor(m.user_id).then((name) =>
              setMessages((prev) =>
                prev.map((x) =>
                  x.id === m.id ? { ...x, author_name: name } : x,
                ),
              ),
            );
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, groupId, nameFor]);

  // Scrolla ned bara när ett nytt meddelande läggs till i slutet.
  useEffect(() => {
    const lastId = messages.at(-1)?.id ?? null;
    if (lastId !== lastIdRef.current) {
      lastIdRef.current = lastId;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    const { error: insertError } = await supabase
      .from("messages")
      .insert({ group_id: groupId, user_id: currentUserId, content });
    setSending(false);
    if (insertError) {
      setError("Kunde inte skicka meddelandet.");
      return;
    }
    setText("");
  }

  async function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0].created_at;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    const older = (data ?? []).slice().reverse();
    const withNames: MessageWithAuthor[] = await Promise.all(
      older.map(async (m) => ({
        ...(m as Message),
        author_name: await nameFor((m as Message).user_id),
      })),
    );
    setMessages((prev) => [...withNames, ...prev]);
    setHasMore((data?.length ?? 0) >= PAGE_SIZE);
    setLoadingOlder(false);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {hasMore ? (
          <div className="mb-3 flex justify-center">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="rounded-full bg-black/5 px-4 py-1.5 text-xs font-medium opacity-70 disabled:opacity-40 dark:bg-white/10"
            >
              {loadingOlder ? "Laddar…" : "Ladda äldre meddelanden"}
            </button>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <p className="mt-10 text-center text-sm opacity-50">
            Inga meddelanden än. Skriv det första!
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => {
              const mine = m.user_id === currentUserId;
              return (
                <li
                  key={m.id}
                  className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                >
                  {!mine ? (
                    <span className="mb-0.5 px-1 text-xs font-medium opacity-60">
                      {m.author_name}
                    </span>
                  ) : null}
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] ${
                      mine
                        ? "rounded-br-md bg-[var(--brand)] text-white"
                        : "rounded-bl-md bg-white text-[var(--foreground)] dark:bg-white/10"
                    }`}
                  >
                    {m.content}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-black/5 bg-[var(--background)] px-3 py-3 dark:border-white/10"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Skriv ett meddelande…"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-full border border-black/10 bg-white/80 px-4 py-2.5 text-base outline-none focus:border-[var(--brand)] dark:border-white/15 dark:bg-white/5"
        />
        <button
          type="submit"
          disabled={sending || text.trim().length === 0}
          className="shrink-0 rounded-full bg-[var(--brand)] px-5 py-2.5 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
        >
          Skicka
        </button>
      </form>
      {error ? (
        <p className="bg-red-500/10 px-4 py-1 text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
