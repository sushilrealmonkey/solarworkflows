import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

export default function ModuleScreen() {
  const { slug = "module" } = useLocalSearchParams<{ slug?: string }>();
  const title = slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  return <SafeAreaView style={styles.safe}><Stack.Screen options={{ headerShown: true, title }} /><View style={styles.content}><View style={styles.icon}><Text style={styles.iconText}>{title.slice(0, 2).toUpperCase()}</Text></View><Text style={styles.title}>{title}</Text><Text style={styles.copy}>This module is ready for its mobile workflow. Business logic will be added in a later phase.</Text></View></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, content: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }, icon: { width: 74, height: 74, borderRadius: 22, backgroundColor: colors.orangeSoft, alignItems: "center", justifyContent: "center" }, iconText: { color: colors.orange, fontSize: 22, fontWeight: "900" }, title: { color: colors.navy, fontSize: 26, fontWeight: "900", marginTop: 18 }, copy: { color: colors.muted, lineHeight: 21, textAlign: "center", marginTop: 8 } });
