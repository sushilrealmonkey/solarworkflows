import { Stack } from "expo-router";
import { ResourceList } from "@/components/ResourceList";
export default function DocumentsScreen() { return <><Stack.Screen options={{ headerShown: true, title: "Documents" }} /><ResourceList resource="documents" title="Documents" showCreate /></>; }
