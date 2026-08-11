import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";
import { queryClient } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { ApiError, mobileApi } from "@/lib/api";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(); const segments = useSegments(); const router = useRouter();
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe(); }, []);
  useEffect(() => {
    if (session === undefined) return;
    const inAuth = segments[0] === "(auth)"; const inEnrollment = segments.join("/").includes("enrollment");
    if (!session && !inAuth) router.replace("/(auth)/login");
    if (session && inAuth && !inEnrollment) void mobileApi.session()
      .then(() => router.replace("/(tabs)/home"))
      .catch((error) => {
        if (error instanceof ApiError && error.code === "ACCOUNT_UNASSIGNED") { router.replace("/(auth)/enrollment"); return; }
        const message = error instanceof ApiError && error.code === "FORBIDDEN"
          ? error.message
          : "Your account was authenticated, but the Bizlee workspace could not be reached. Please try again.";
        Alert.alert("Unable to open workspace", message);
        setTimeout(() => { void supabase.auth.signOut(); }, 0);
      });
  }, [session, segments, router]);
  return <QueryClientProvider client={queryClient}><StatusBar style="auto" /><Stack screenOptions={{ headerShown: false }} /></QueryClientProvider>;
}
