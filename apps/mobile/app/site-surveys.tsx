import { Stack } from "expo-router";
import { ResourceList } from "@/components/ResourceList";
import { useEffect, useState } from "react";
import { FieldWorkList } from "@/components/FieldWorkList";
import { mobileApi } from "@/lib/api";
export default function SiteSurveysScreen() { const [field, setField] = useState<boolean | null>(null); useEffect(() => { void mobileApi.session().then((context) => setField(context.roles.includes("Field Staff"))).catch(() => setField(false)); }, []); return <><Stack.Screen options={{ headerShown: true, title: "Site surveys" }} />{field === null ? null : field ? <FieldWorkList resource="site-surveys" title="Site surveys" /> : <ResourceList resource="site-surveys" title="Site surveys" showCreate />}</>; }
