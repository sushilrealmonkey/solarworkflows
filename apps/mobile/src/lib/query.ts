import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 24 * 60 * 60_000, retry: 2 }, mutations: { retry: 0 } } });
export async function saveDraft(userId: string, companyId: string, form: string, value: unknown) { await AsyncStorage.setItem(`draft:${userId}:${companyId}:${form}`, JSON.stringify(value)); }
export async function loadDraft<T>(userId: string, companyId: string, form: string): Promise<T | null> { const value = await AsyncStorage.getItem(`draft:${userId}:${companyId}:${form}`); return value ? JSON.parse(value) as T : null; }
export async function clearDraft(userId: string, companyId: string, form: string) { await AsyncStorage.removeItem(`draft:${userId}:${companyId}:${form}`); }
