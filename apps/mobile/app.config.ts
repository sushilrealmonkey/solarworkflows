import type { ExpoConfig } from "expo/config";

const profile = process.env.APP_ENV ?? "development";
const suffix = profile === "production" ? "" : `.${profile}`;
const expoProjectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID;
const appVersion = process.env.APP_VERSION ?? "0.1.0";
const rawBuildNumber = process.env.BUILD_NUMBER ?? "1";
const androidVersionCode = Number(rawBuildNumber);

if (!/^[1-9]\d*$/.test(rawBuildNumber) || !Number.isSafeInteger(androidVersionCode) || androidVersionCode > 2_100_000_000) {
  throw new Error("BUILD_NUMBER must be an integer between 1 and 2100000000");
}

export default (): ExpoConfig => ({
  name: profile === "production" ? "Bizlee" : `Bizlee ${profile}`,
  slug: "bizlee-mobile",
  scheme: "bizlee",
  version: appVersion,
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: `com.bizlee.mobile${suffix}`,
    buildNumber: rawBuildNumber,
    associatedDomains: ["applinks:app.getbizlee.com"],
    config: { usesNonExemptEncryption: false }
  },
  android: {
    package: `com.bizlee.mobile${suffix}`,
    versionCode: androidVersionCode,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON_PATH,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#06173f" },
    intentFilters: [{ action: "VIEW", autoVerify: true, data: [{ scheme: "https", host: "app.getbizlee.com", pathPrefix: "/mobile" }], category: ["BROWSABLE", "DEFAULT"] }]
  },
  plugins: ["expo-router", "expo-secure-store", ["expo-splash-screen", { image: "./assets/splash-logo.png", imageWidth: 240, resizeMode: "contain", backgroundColor: "#ffffff", dark: { backgroundColor: "#06173f", image: "./assets/splash-logo.png" } }], ["expo-notifications", { color: "#f97316" }]],
  extra: { profile, apiUrl: process.env.EXPO_PUBLIC_API_URL, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL, supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, push: { projectId: expoProjectId } }
});
