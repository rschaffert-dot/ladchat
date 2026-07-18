import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatRoom } from "@/components/ChatRoom";
import { InvitePanel } from "@/components/InvitePanel";
import { leaveGroupAction } from "@/app/groups/actions";
import type { Group, Message, MessageWithAuthor } from "@/lib/types";

const PAGE_SIZE = 30;

export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS: returnerar bara gruppen om du är medlem.
  const { data: group } = await supabase
    .from("groups")
    .select("id,name,owner_id,created_at")
    .eq("id", groupId)
    .single<Group>();

  if (!group) notFound();

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id,role")
    .eq("group_id", groupId);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

  const names: Record<string, string> = {};
  (profiles ?? []).forEach((p) => {
    names[p.id] = p.display_name || p.email || "Okänd";
  });

  const { data: rawMessages } = await supabase
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const ordered = ((rawMessages ?? []) as Message[]).slice().reverse();
  const initialMessages: MessageWithAuthor[] = ordered.map((m) => ({
    ...m,
    author_name: names[m.user_id] ?? "Okänd",
  }));

  const isOwner = group.owner_id === user?.id;
  const memberCount = memberIds.length;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="flex items-center gap-2 border-b border-black/5 px-3 py-3 dark:border-white/10">
        <Link
          href="/groups"
          className="rounded-lg px-2 py-1.5 text-lg opacity-70 transition hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Tillbaka"
        >
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight">
            {group.name}
          </h1>
          <p className="text-xs opacity-55">
            {memberCount} {memberCount === 1 ? "medlem" : "medlemmar"}
          </p>
        </div>
        <InvitePanel groupId={group.id} />
        {!isOwner ? (
          <form action={leaveGroupAction}>
            <input type="hidden" name="group_id" value={group.id} />
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
            >
              Lämna
            </button>
          </form>
        ) : null}
      </header>

      <ChatRoom
        groupId={group.id}
        currentUserId={user!.id}
        initialMessages={initialMessages}
        initialNames={names}
      />
    </div>
  );
}
