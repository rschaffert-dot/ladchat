import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import type { ActivationKind } from "@/lib/types";

const BUCKET = "activation-media";

/** Metadata per aktivitetstyp — datadrivet så nya typer kan speglas i UI:t. */
export const ACTIVATION_KINDS: Record<
  ActivationKind,
  { label: string; emoji: string; blurb: string; needsMedia: boolean }
> = {
  thumb_order: {
    label: "Tummen på bordet",
    emoji: "👍",
    blurb: "Alla skickar en tumme upp. Först in får flest poäng, sist får 1p.",
    needsMedia: false,
  },
  longest_fart: {
    label: "Längsta prutten",
    emoji: "💨",
    blurb: "Ladda upp en inspelning på en prutt. Längst inspelning vinner.",
    needsMedia: true,
  },
};

export const ACTIVATION_KIND_OPTIONS = Object.keys(
  ACTIVATION_KINDS,
) as ActivationKind[];

/** Laddar upp prutt-media till den privata bucketen. Sökväg: {activation}/{group}/{user}-ts.ext */
export async function uploadActivationMedia(
  activationId: string,
  groupId: string,
  userId: string,
  localUri: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = mimeType.split("/")[1] ?? "mp4";
  const path = `${activationId}/${groupId}/${userId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mimeType,
  });
  if (error) throw error;
  return path;
}

export async function getSignedMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Formaterar millisekunder som "12,3s". */
export function formatDuration(ms: number | null): string {
  if (!ms) return "0s";
  return `${(ms / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}s`;
}

/**
 * Läser ut en videos längd i millisekunder. På web gör vi det via ett
 * <video>-element eftersom expo-image-picker inte alltid fyller i duration där.
 */
export async function videoDurationMs(uri: string): Promise<number> {
  if (Platform.OS !== "web" || typeof document === "undefined") return 0;
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
    v.onerror = () => resolve(0);
    v.src = uri;
  });
}
