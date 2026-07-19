import { supabase } from "@/lib/supabase";

/** Bild-/ljuduppladdning till privata bucketen chat-media ({group_id}/{user_id}/{fil}). */

function extensionFor(mime: string): string {
  if (mime.startsWith("video/")) {
    if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
    if (mime.includes("webm")) return "webm";
    return "mp4";
  }
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "jpg";
}

export async function uploadChatMedia(
  groupId: string,
  userId: string,
  source: string | Blob,
  mimeType: string,
): Promise<string> {
  const blob =
    typeof source === "string" ? await fetch(source).then((r) => r.blob()) : source;
  const path = `${groupId}/${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${extensionFor(mimeType)}`;
  const { error } = await supabase.storage
    .from("chat-media")
    .upload(path, blob, { contentType: mimeType });
  if (error) throw error;
  return path;
}

const urlCache = new Map<string, string>();

export async function getChatMediaUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const { data, error } = await supabase.storage
    .from("chat-media")
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  urlCache.set(path, data.signedUrl);
  return data.signedUrl;
}
