import { supabase } from "@/lib/supabase";

const BUCKET = "group-icons";

/**
 * Laddar upp en egen gruppikon till den publika group-icons-bucketen och
 * sparar sökvägen på gruppen. Sökväg: "{group_id}/icon-ts.ext". Alla
 * medlemmar i gruppen får skriva dit (RLS via is_group_member()).
 */
export async function uploadGroupIcon(
  groupId: string,
  localUri: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = (mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
  const path = `${groupId}/icon-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mimeType,
  });
  if (error) throw error;

  // groups-tabellens RLS tillåter bara ägaren att UPDATE:a raden direkt —
  // set_group_icon() är en egen RPC som släpper in alla gruppmedlemmar.
  const { error: rpcError } = await supabase.rpc("set_group_icon", {
    gid: groupId,
    path,
  });
  if (rpcError) throw rpcError;

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Publik URL för en gruppikon-sökväg (bucketen är publik). */
export function groupIconUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Tar bort den egna ikonen — rutan går tillbaka till medlemsmosaiken. */
export async function clearGroupIcon(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("set_group_icon", { gid: groupId, path: null });
  if (error) throw error;
}
