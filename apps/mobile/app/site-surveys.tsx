import { Stack } from "expo-router";
import { ResourceList } from "@/components/ResourceList";
export default function SiteSurveysScreen() { return <><Stack.Screen options={{ headerShown: true, title: "Site surveys" }} /><ResourceList resource="site-surveys" title="Site surveys" /></>; }
