import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { useAuth } from "@/lib/auth";
import { NEEDS_AVATAR_KEY, uploadAvatar } from "@/lib/avatar";
import { useColors } from "@/lib/ui";

export default function AvatarOnboardingScreen() {
  const c = useColors();
  const router = useRouter();
  const { userId } = useAuth();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pickedMime, setPickedMime] = useState<string>("image/jpeg");
  const [busy, setBusy] = useState(false);

  async function finish() {
    await AsyncStorage.removeItem(NEEDS_AVATAR_KEY);
    router.replace("/groups");
  }

  async function pick(useCamera: boolean) {
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7,
        });
    if (result.canceled || !result.assets[0]) return;
    setPreviewUri(result.assets[0].uri);
    setPickedMime(result.assets[0].mimeType ?? "image/jpeg");
  }

  async function save() {
    if (!previewUri || !userId || busy) return;
    setBusy(true);
    try {
      await uploadAvatar(userId, previewUri, pickedMime);
      await finish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: c.text }]}>Lägg till en bild</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Ta en selfie eller välj ett foto. Den blir din avatar i chatten.
        </Text>

        <View
          style={[
            styles.avatarPreview,
            { backgroundColor: c.backgroundElement, borderColor: c.backgroundSelected },
          ]}
        >
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.avatarImg} />
          ) : (
            <AppIcon name="camera" size={52} color={c.textSecondary} strokeWidth={1.4} />
          )}
        </View>

        <View style={styles.pickRow}>
          <Pressable
            onPress={() => pick(true)}
            disabled={busy}
            style={[styles.pickBtn, { borderColor: c.backgroundSelected }]}
          >
            <Text style={[styles.pickText, { color: c.text }]}>Ta bild</Text>
          </Pressable>
          <Pressable
            onPress={() => pick(false)}
            disabled={busy}
            style={[styles.pickBtn, { borderColor: c.backgroundSelected }]}
          >
            <Text style={[styles.pickText, { color: c.text }]}>Välj foto</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={save}
          disabled={busy || !previewUri}
          style={[
            styles.saveBtn,
            { backgroundColor: c.brand, opacity: busy || !previewUri ? 0.5 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>Spara avatar</Text>
          )}
        </Pressable>

        <Pressable onPress={finish} disabled={busy} hitSlop={8} style={styles.skip}>
          <Text style={{ color: c.textSecondary }}>Hoppa över för nu</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 16,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: 8 },
  avatarPreview: {
    width: 180,
    height: 180,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  pickRow: { flexDirection: "row", gap: 12, width: "100%" },
  pickBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  pickText: { fontSize: 15, fontWeight: "700" },
  saveBtn: {
    width: "100%",
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  skip: { marginTop: 4, padding: 8 },
});
