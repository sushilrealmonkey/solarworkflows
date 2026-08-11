import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme";
import { useEffect, useMemo, useState } from "react";
import type { MobileActionKey, MobileModuleKey, SessionContext } from "@bizlee/contracts";
import { hasMobilePermission, mobileApi } from "@/lib/api";

const quickActions = [
  { label: "Add Enquiry", icon: "+", path: "/new-record?resource=enquiries", module: "leads", action: "create" },
  { label: "Add Payment", icon: "₹", path: "/module/payments", module: "payments", action: "create" },
  { label: "Create Quotation", icon: "≡", path: "/quotations", module: "quotations", action: "create" },
] as const;
const dueItems = [
  { label: "Call back new enquiries", meta: "Due today · Sales", overdue: false },
  { label: "Collect project payment", meta: "Overdue · Payments", overdue: true },
  { label: "Confirm site survey", meta: "Due today · Site surveys", overdue: false },
] as const;
const modules: Array<[string, string, string, MobileModuleKey | null]> = [
  ["Enquiries", "EN", "/(tabs)/sales", "leads"], ["Customers", "CU", "/(tabs)/sales", "customers"], ["Site Surveys", "SS", "/site-surveys", "site_surveys"], ["Quotations", "QT", "/quotations", "quotations"],
  ["Projects", "PR", "/(tabs)/projects", "projects"], ["Payments", "₹", "/module/payments", "payments"], ["Invoices", "IN", "/module/invoices", "invoices"], ["Inventory", "IV", "/(tabs)/inventory", "inventory"],
  ["Purchases", "PO", "/module/purchases", "purchases"], ["Vendors", "VE", "/module/vendors", "vendors"], ["Documents", "DC", "/documents", "documents"], ["Team", "TM", "/module/team", "staff"],
  ["Notifications", "NT", "/notifications", null], ["Reports", "RP", "/(tabs)/dashboard", "reports"], ["Settings", "ST", "/module/settings", "settings"],
];

export default function HomeScreen() {
  const [context, setContext] = useState<SessionContext | null>(null);
  useEffect(() => { void mobileApi.session().then(setContext).catch(() => setContext(null)); }, []);
  const router = useRouter(); const open = (path: string) => router.push(path as never);
  const visibleActions = useMemo(() => quickActions.filter((item) => hasMobilePermission(context, item.module as MobileModuleKey, item.action as MobileActionKey)), [context]);
  const visibleModules = useMemo(() => modules.filter((item) => item[3] === null || hasMobilePermission(context, item[3])), [context]);
  return <SafeAreaView style={styles.safe} edges={["top"]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><View><Text style={styles.hello}>Good day</Text><Text style={styles.title}>Your Bizlee workspace</Text></View><Image accessibilityLabel="Bizlee" source={
      // Expo resolves this static asset at bundle time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../../assets/icon.png")
    } style={styles.mark} /></View>
    <Text style={styles.sectionTitle}>Quick actions</Text>
    <View style={styles.quickRow}>{visibleActions.map((action) => <Pressable key={action.label} onPress={() => open(action.path)} style={styles.quickButton}><Text style={styles.quickIcon}>{action.icon}</Text><Text style={styles.quickLabel}>{action.label}</Text></Pressable>)}</View>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitleFlush}>Due now</Text><Pressable onPress={() => open("/due-actions")}><Text style={styles.viewAll}>View all →</Text></Pressable></View>
    <View style={styles.dueCard}>{dueItems.map((item, index) => <Pressable key={item.label} onPress={() => open("/due-actions")} style={[styles.dueRow, index < 2 && styles.divider]}><View style={[styles.dot, item.overdue && styles.dotOverdue]} /><View style={styles.dueBody}><Text style={styles.dueLabel}>{item.label}</Text><Text style={styles.dueMeta}>{item.meta}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</View>
    <Pressable onPress={() => open("/(tabs)/today")} style={styles.aiButton}><View style={styles.aiBadge}><Text style={styles.aiSpark}>✦</Text></View><View style={styles.aiBody}><Text style={styles.aiTitle}>Bizlee AI</Text><Text style={styles.aiCopy}>Ask questions and view your daily brief</Text></View><Text style={styles.aiArrow}>→</Text></Pressable>
    <View style={styles.sectionHeader}><Text style={styles.sectionTitleFlush}>All modules</Text><Text style={styles.count}>{visibleModules.length} modules</Text></View>
    <View style={styles.grid}>{visibleModules.map(([label, short, path], index) => <Pressable key={label} onPress={() => open(path)} style={styles.module}><View style={[styles.moduleIcon, index % 3 === 0 && styles.moduleIconOrange]}><Text style={[styles.moduleShort, index % 3 === 0 && styles.moduleShortOrange]}>{short}</Text></View><Text numberOfLines={2} style={styles.moduleLabel}>{label}</Text></Pressable>)}</View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, content: { padding: 18, paddingBottom: 34 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 23 }, hello: { color: colors.muted, fontSize: 13, fontWeight: "600" }, title: { color: colors.navy, fontSize: 24, fontWeight: "900", marginTop: 2 }, mark: { width: 44, height: 44, borderRadius: 13 },
  sectionTitle: { color: colors.navy, fontSize: 18, fontWeight: "900", marginBottom: 12 }, sectionTitleFlush: { color: colors.navy, fontSize: 18, fontWeight: "900" }, sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 }, viewAll: { color: colors.orange, fontSize: 13, fontWeight: "800" }, count: { color: colors.muted, fontSize: 12 },
  quickRow: { flexDirection: "row", gap: 9 }, quickButton: { flex: 1, minHeight: 94, backgroundColor: colors.navy, borderRadius: 16, padding: 12, justifyContent: "space-between" }, quickIcon: { color: colors.orange, fontSize: 23, fontWeight: "900" }, quickLabel: { color: "white", fontSize: 13, lineHeight: 17, fontWeight: "800" },
  dueCard: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 }, dueRow: { minHeight: 67, flexDirection: "row", alignItems: "center" }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.orange, marginRight: 12 }, dotOverdue: { backgroundColor: colors.danger }, dueBody: { flex: 1 }, dueLabel: { color: colors.ink, fontSize: 14, fontWeight: "800" }, dueMeta: { color: colors.muted, fontSize: 12, marginTop: 4 }, chevron: { color: colors.muted, fontSize: 25 },
  aiButton: { minHeight: 78, backgroundColor: colors.navy, borderRadius: 18, flexDirection: "row", alignItems: "center", paddingHorizontal: 15, marginTop: 22 }, aiBadge: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" }, aiSpark: { color: "white", fontSize: 23 }, aiBody: { flex: 1, marginLeft: 12 }, aiTitle: { color: "white", fontSize: 17, fontWeight: "900" }, aiCopy: { color: "#cbd5e1", fontSize: 11, marginTop: 3 }, aiArrow: { color: colors.orange, fontSize: 24, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }, module: { width: "25%", alignItems: "center", paddingHorizontal: 4, marginBottom: 19 }, moduleIcon: { width: 58, height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#e8edf7", borderWidth: 1, borderColor: "#d9e1ef" }, moduleIconOrange: { backgroundColor: colors.orangeSoft, borderColor: "#fed7aa" }, moduleShort: { color: colors.navy, fontSize: 16, fontWeight: "900" }, moduleShortOrange: { color: colors.orange }, moduleLabel: { color: colors.ink, textAlign: "center", fontSize: 11, lineHeight: 14, fontWeight: "700", marginTop: 7 },
});
