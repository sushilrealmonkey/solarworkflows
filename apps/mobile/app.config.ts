import type { ExpoConfig } from "expo/config";
const profile = process.env.APP_ENV ?? "development";
const suffix = profile === "production" ? "" : `.${profile}`;
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "af7c2441-0768-4c4d-a4cc-69a151d91784";
export default (): ExpoConfig => ({
  name: profile === "production" ? "Bizlee" : `Bizlee ${profile}`,
  slug: "bizlee-mobile", scheme: "bizlee", version: "0.1.0", orientation: "portrait", userInterfaceStyle: "automatic", icon: "./assets/icon.png",
  ios: { supportsTablet: true, bundleIdentifier: `com.bizlee.mobile${suffix}`, associatedDomains: ["applinks:app.getbizlee.com"] },
  android: { package: `com.bizlee.mobile${suffix}`, adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#06173f" }, intentFilters: [{ action: "VIEW", autoVerify: true, data: [{ scheme: "https", host: "app.getbizlee.com", pathPrefix: "/mobile" }], category: ["BROWSABLE", "DEFAULT"] }] },
  plugins: ["expo-router", "expo-secure-store", ["expo-splash-screen", { image: "./assets/splash-logo.png", imageWidth: 240, resizeMode: "contain", backgroundColor: "#ffffff", dark: { backgroundColor: "#06173f", image: "./assets/splash-logo.png" } }], ["expo-notifications", { color: "#f97316" }]],
  extra: { profile, apiUrl: process.env.EXPO_PUBLIC_API_URL, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL, supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, eas: { projectId: easProjectId } }
});
