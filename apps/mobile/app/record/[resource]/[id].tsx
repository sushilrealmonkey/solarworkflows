import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { RecordDetail } from "@/components/RecordDetail";
import { isMobileResource, moduleConfigs } from "@/modules/moduleConfig";
export default function DetailRoute() { const { resource, id } = useLocalSearchParams<{ resource?: string; id?: string }>(); if (!isMobileResource(resource) || !id) return <View><Text>Record not found</Text></View>; const config = moduleConfigs[resource]; return <><Stack.Screen options={{ headerShown: true, title: config.singular.charAt(0).toUpperCase() + config.singular.slice(1) }} /><RecordDetail config={config} id={id} /></>; }
