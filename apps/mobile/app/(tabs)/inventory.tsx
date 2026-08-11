import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "@/theme";

const inventorySections = [
  ["Stock overview", "Current quantities and availability"],
  ["Products & materials", "Catalog, brands and specifications"],
  ["Stock movements", "Receipts, issues and adjustments"],
  ["Low stock", "Items that need attention"],
] as const;

export default function InventoryScreen() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe} edges={["top"]}><ScrollView contentContainerStyle={styles.content}><Text style={styles.eyebrow}>BIZLEE</Text><Text style={styles.title}>Inventory</Text><Text style={styles.copy}>View stock details and inventory activity.</Text><View style={styles.cards}>{inventorySections.map(([title, copy]) => <Pressable key={title} onPress={() => router.push(`/module/${title.toLowerCase().replaceAll(" ", "-")}` as never)} style={styles.card}><View style={styles.icon}><Text style={styles.iconText}>{title.slice(0, 2).toUpperCase()}</Text></View><View style={styles.body}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardCopy}>{copy}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</View></ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, content: { padding: 18, paddingBottom: 40 }, eyebrow: { color: colors.orange, fontWeight: "900", letterSpacing: 2, marginTop: 6 }, title: { color: colors.navy, fontSize: 30, fontWeight: "900", marginTop: 4 }, copy: { color: colors.muted, marginTop: 6, marginBottom: 22 }, cards: { gap: 11 }, card: { minHeight: 78, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", padding: 13 }, icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.orangeSoft, alignItems: "center", justifyContent: "center" }, iconText: { color: colors.orange, fontWeight: "900" }, body: { flex: 1, marginLeft: 12 }, cardTitle: { color: colors.ink, fontWeight: "800", fontSize: 15 }, cardCopy: { color: colors.muted, fontSize: 12, marginTop: 4 }, chevron: { color: colors.muted, fontSize: 26 } });
