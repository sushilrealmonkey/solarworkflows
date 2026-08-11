import { Tabs } from "expo-router";
import { usePushNotifications } from "@/lib/push";
import { TabIcon } from "@/components/TabIcon";
import { colors } from "@/theme";
import { useEffect, useState } from "react";
import type { SessionContext } from "@bizlee/contracts";
import { hasMobilePermission, mobileApi } from "@/lib/api";

export default function TabsLayout() {
  usePushNotifications();
  const [context, setContext] = useState<SessionContext | null>(null);
  useEffect(() => { void mobileApi.session().then(setContext).catch(() => setContext(null)); }, []);
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.orange, tabBarInactiveTintColor: colors.muted, tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 }, tabBarStyle: { height: 72, paddingTop: 7, paddingBottom: 9, borderTopColor: colors.border, backgroundColor: colors.surface } }}>
    <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
    <Tabs.Screen name="dashboard" options={{ title: "Dashboard", href: hasMobilePermission(context, "dashboard") ? undefined : null, tabBarIcon: ({ focused }) => <TabIcon name="dashboard" focused={focused} /> }} />
    <Tabs.Screen name="projects" options={{ title: "Projects", href: hasMobilePermission(context, "projects") ? undefined : null, tabBarIcon: ({ focused }) => <TabIcon name="projects" focused={focused} /> }} />
    <Tabs.Screen name="inventory" options={{ title: "Inventory", href: hasMobilePermission(context, "inventory") ? undefined : null, tabBarIcon: ({ focused }) => <TabIcon name="inventory" focused={focused} /> }} />
    <Tabs.Screen name="today" options={{ href: null }} />
    <Tabs.Screen name="sales" options={{ href: null }} />
    <Tabs.Screen name="more" options={{ href: null }} />
  </Tabs>;
}
