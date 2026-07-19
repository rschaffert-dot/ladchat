import { supabase } from "@/lib/supabase";

const BUCKET = "challenge-submissions";

/** Laddar upp en bild till den privata bucketen. RLS styr vem som kan skriva var. */
export async function uploadChallengeImage(
  challengeId: string,
  groupId: string,
  userId: string,
  localUri: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${challengeId}/${groupId}/${userId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mimeType,
  });
  if (error) throw error;
  return path;
}

/** Hämtar en tillfällig signerad URL för en bild — respekterar samma RLS som tabellraden. */
export async function getSignedImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}
