import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";

const links = [
  { label: "Notifications", description: "Updates and assigned work", path: "/notifications" as const },
  { label: "Site surveys", description: "Appointments and field records", path: "/site-surveys" as const },
  { label: "Quotations", description: "Proposals and approvals", path: "/quotations" as const },
  { label: "Documents", description: "Customer and project files", path: "/documents" as const },
];
export default function MoreScreen() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}><ScrollView style={styles.page} contentContainerStyle={styles.content}><Text style={styles.title}>More</Text><View style={styles.group}>{links.map((link) => <Pressable accessibilityRole="button" key={link.path} onPress={() => router.push(link.path)} style={styles.link}><View style={styles.linkBody}><Text style={styles.linkTitle}>{link.label}</Text><Text style={styles.description}>{link.description}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</View><Pressable accessibilityRole="button" onPress={() => void supabase.auth.signOut()} style={styles.logout}><Text style={styles.logoutText}>Sign out</Text></Pressable></ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#f8fafc" }, page: { flex: 1 }, content: { padding: 18, paddingTop: 34, paddingBottom: 40 }, title: { fontSize: 30, fontWeight: "800", color: "#06173f", marginBottom: 20 }, group: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0" }, link: { minHeight: 72, flexDirection: "row", alignItems: "center", backgroundColor: "white", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" }, linkBody: { flex: 1 }, linkTitle: { color: "#0f172a", fontSize: 16, fontWeight: "700" }, description: { color: "#64748b", marginTop: 3 }, chevron: { color: "#94a3b8", fontSize: 28 }, logout: { marginTop: 24, padding: 15, borderRadius: 12, borderWidth: 1, borderColor: "#fecaca", alignItems: "center", backgroundColor: "white" }, logoutText: { color: "#b91c1c", fontWeight: "800" } });
