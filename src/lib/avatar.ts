import { supabase } from "@/lib/supabase";

const BUCKET = "avatars";

/** AsyncStorage-flagga: nyregistrerad användare som ännu inte valt avatar. */
export const NEEDS_AVATAR_KEY = "ladchat.needs_avatar";

/**
 * Laddar upp en profilbild till den publika avatars-bucketen och sparar
 * sökvägen på profilen. Sökväg: "{user_id}/avatar-ts.ext". Returnerar
 * den publika URL:en. Var och en får bara skriva i sin egen mapp (RLS).
 */
export async function uploadAvatar(
  userId: string,
  localUri: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = (mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Publik URL för en avatar-sökväg (bucketen är publik). */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
