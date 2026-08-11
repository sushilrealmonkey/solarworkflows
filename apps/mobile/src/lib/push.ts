import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { mobileApi } from "./api";

const DEVICE_ID_KEY = "bizlee.mobile.device-id";
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });

async function installationId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY); if (existing) return existing;
  const next = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, next); return next;
}

export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Bizlee updates", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: "#f97316" });
  const current = await Notifications.getPermissionsAsync(); const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.push?.projectId; if (!projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data; const deviceId = await installationId();
  await mobileApi.registerDevice({ expoPushToken: token, platform: Platform.OS as "android" | "ios", deviceId, appVersion: Constants.expoConfig?.version ?? "unknown", locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-IN" });
  return { token, deviceId };
}

function notificationPath(raw: unknown) {
  if (typeof raw !== "string") return "/notifications" as const;
  if (raw.startsWith("/projects")) return "/(tabs)/projects" as const;
  if (raw.startsWith("/leads") || raw.startsWith("/customers")) return "/(tabs)/sales" as const;
  return "/notifications" as const;
}

export function usePushNotifications() {
  const router = useRouter();
  useEffect(() => {
    void registerForPushNotifications().catch(() => undefined);
    const response = Notifications.addNotificationResponseReceivedListener((event) => router.push(notificationPath(event.notification.request.content.data?.destinationRoute)));
    void Notifications.getLastNotificationResponseAsync().then((event) => { if (event) router.push(notificationPath(event.notification.request.content.data?.destinationRoute)); });
    return () => response.remove();
  }, [router]);
}
