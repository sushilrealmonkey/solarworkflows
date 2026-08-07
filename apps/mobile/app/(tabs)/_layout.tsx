import { Tabs } from "expo-router";
import { usePushNotifications } from "@/lib/push";

export default function TabsLayout() {
  usePushNotifications();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: "#f97316", tabBarInactiveTintColor: "#64748b", tabBarStyle: { height: 66, paddingBottom: 8 } }}><Tabs.Screen name="today" options={{ title: "Today" }} /><Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} /><Tabs.Screen name="sales" options={{ title: "Sales" }} /><Tabs.Screen name="projects" options={{ title: "Projects" }} /><Tabs.Screen name="more" options={{ title: "More" }} /></Tabs>;
}
