import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { mobileApi } from "@/lib/api";
import { colors } from "@/theme";

export function FieldWorkList({ resource, title }: { resource: "projects" | "site-surveys"; title: string }) {
  const router = useRouter();
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void (resource === "projects" ? mobileApi.fieldProjects() : mobileApi.fieldSurveys()).then((result) => setRecords(result.data)).catch((value) => setError(value instanceof Error ? value.message : "Unable to load assigned work.")); }, [resource]);
  return <ScrollView contentContainerStyle={styles.content}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>Assigned work only</Text>{error ? <Text style={styles.error}>{error}</Text> : null}{records.length === 0 && !error ? <Text style={styles.empty}>No assigned work is available.</Text> : null}{records.map((record) => { const id = String(record.id); const status = String(record.project_status ?? record.survey_status ?? ""); const code = String(record.project_code ?? record.survey_code ?? "Assigned work"); const name = String(record.project_name ?? record.customer_name ?? record.contact_name ?? "Site visit"); return <Pressable key={id} onPress={() => router.push(`/field/${resource}/${id}` as never)} style={styles.card}><View style={styles.row}><Text style={styles.code}>{code}</Text><Text style={styles.status}>{status.replaceAll("_", " ")}</Text></View><Text style={styles.name}>{name}</Text><Text style={styles.meta}>{String(record.installation_address ?? record.site_address ?? record.scheduled_date ?? "")}</Text></Pressable>; })}</ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: 18, paddingBottom: 40, backgroundColor: colors.background, flexGrow: 1 }, title: { color: colors.navy, fontSize: 26, fontWeight: "900" }, subtitle: { color: colors.muted, marginTop: 4, marginBottom: 18 }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, marginBottom: 12 }, row: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, code: { color: colors.muted, fontSize: 11, fontWeight: "800" }, status: { color: colors.orange, fontSize: 11, fontWeight: "900", textTransform: "capitalize" }, name: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 8 }, meta: { color: colors.muted, fontSize: 13, marginTop: 6 }, error: { color: colors.danger }, empty: { color: colors.muted, marginTop: 24 } });
