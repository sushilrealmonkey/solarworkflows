import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { ModuleForm } from "@/components/ModuleForm";
import { isMobileResource, moduleConfigs } from "@/modules/moduleConfig";
export default function FormRoute() { const { resource } = useLocalSearchParams<{ resource?: string }>(); if (!isMobileResource(resource)) return <View><Text>Form not found</Text></View>; const config = moduleConfigs[resource]; return <><Stack.Screen options={{ headerShown: true, title: `New ${config.singular}` }} /><ModuleForm config={config} /></>; }
