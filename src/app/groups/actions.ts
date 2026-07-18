"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type GroupFormState = { error?: string };
export type InviteResult = { error?: string; token?: string };

/** Skapar en grupp (atomiskt via RPC) och går till gruppens chatt. */
export async function createGroupAction(
  _prev: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Gruppen behöver ett namn." };
  if (name.length > 80) return { error: "Namnet är för långt (max 80 tecken)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_group", {
    group_name: name,
  });
  if (error) return { error: error.message };

  revalidatePath("/groups");
  redirect(`/groups/${data as string}`);
}

/** Skapar en inbjudningslänk (token) för gruppen. */
export async function createInviteAction(
  formData: FormData,
): Promise<InviteResult> {
  const groupId = String(formData.get("group_id") ?? "");
  if (!groupId) return { error: "Grupp saknas." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Du är inte inloggad." };

  const { data, error } = await supabase
    .from("group_invites")
    .insert({ group_id: groupId, created_by: user.id })
    .select("token")
    .single();
  if (error) return { error: error.message };

  return { token: data.token as string };
}

/** Lämnar en grupp (raderar din medlemsrad) och går till grupplistan. */
export async function leaveGroupAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("group_id") ?? "");
  if (!groupId) redirect("/groups");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", user.id);
  }

  revalidatePath("/groups");
  redirect("/groups");
}
