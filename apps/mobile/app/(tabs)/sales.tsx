import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ResourceList } from "@/components/ResourceList";

export default function SalesScreen() {
  const [view, setView] = useState<"enquiries" | "customers">("enquiries"); const router = useRouter();
  return <View style={styles.page}><View style={styles.header}><View style={styles.tabs}><Pressable onPress={() => setView("enquiries")} style={[styles.tab, view === "enquiries" && styles.active]}><Text>Enquiries</Text></Pressable><Pressable onPress={() => setView("customers")} style={[styles.tab, view === "customers" && styles.active]}><Text>Customers</Text></Pressable></View><Pressable accessibilityLabel={`Add ${view === "enquiries" ? "enquiry" : "customer"}`} onPress={() => router.push({ pathname: "/new-record", params: { resource: view } })} style={styles.add}><Text style={styles.addText}>+</Text></Pressable></View><ResourceList resource={view} title={view === "enquiries" ? "Enquiries" : "Customers"} /></View>;
}
const styles = StyleSheet.create({ page: { flex: 1, paddingTop: 54, backgroundColor: "#f8fafc" }, header: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 18 }, tabs: { flex: 1, flexDirection: "row", backgroundColor: "#e2e8f0", padding: 4, borderRadius: 12 }, tab: { flex: 1, alignItems: "center", padding: 10, borderRadius: 9 }, active: { backgroundColor: "white" }, add: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#f97316" }, addText: { color: "white", fontSize: 27, lineHeight: 29, fontWeight: "600" } });
