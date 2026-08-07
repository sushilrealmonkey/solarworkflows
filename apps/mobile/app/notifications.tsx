import { FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mobileApi } from "@/lib/api";

function notificationPath(raw: string) {
  if (raw.startsWith("/projects")) return "/(tabs)/projects" as const;
  if (raw.startsWith("/leads") || raw.startsWith("/customers")) return "/(tabs)/sales" as const;
  if (raw.startsWith("/site-surveys")) return "/site-surveys" as const;
  if (raw.startsWith("/quotations")) return "/quotations" as const;
  return "/(tabs)/dashboard" as const;
}

export default function NotificationsScreen() {
  const router = useRouter(); const queryClient = useQueryClient(); const query = useQuery({ queryKey: ["notifications"], queryFn: mobileApi.notifications });
  const read = useMutation({ mutationFn: mobileApi.markNotificationRead, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  const readAll = useMutation({ mutationFn: mobileApi.markAllNotificationsRead, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  return <SafeAreaView style={styles.page}><Stack.Screen options={{ headerShown: true, title: "Notifications", headerRight: () => <Pressable onPress={() => readAll.mutate()}><Text style={styles.action}>Read all</Text></Pressable> }} /><FlatList data={query.data?.data ?? []} keyExtractor={(item) => item.receipt_id} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable onPress={() => { if (!item.read_at) read.mutate(item.receipt_id); router.push(notificationPath(item.destination_route)); }} style={[styles.card, !item.read_at && styles.unread]}><View style={styles.row}><Text style={styles.title}>{item.title}</Text>{!item.read_at && <View style={styles.dot} />}</View><Text style={styles.message}>{item.message}</Text><Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text></Pressable>} ListEmptyComponent={<Text style={styles.empty}>{query.error instanceof Error ? query.error.message : "You're all caught up."}</Text>} /></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#f8fafc" }, list: { padding: 16, gap: 10 }, action: { color: "#0f766e", fontWeight: "700" }, card: { backgroundColor: "white", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 14, padding: 15 }, unread: { borderColor: "#fdba74", backgroundColor: "#fff7ed" }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, title: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0f172a" }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#f97316" }, message: { color: "#475569", lineHeight: 21, marginTop: 7 }, time: { color: "#94a3b8", fontSize: 12, marginTop: 9 }, empty: { textAlign: "center", color: "#64748b", marginTop: 50 } });
