import { Stack } from "expo-router";
import { ResourceList } from "@/components/ResourceList";
export default function QuotationsScreen() { return <><Stack.Screen options={{ headerShown: true, title: "Quotations" }} /><ResourceList resource="quotations" title="Quotations" showCreate /></>; }
