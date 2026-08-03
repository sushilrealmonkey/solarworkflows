import { supabase } from "../../services/supabaseClient";
import type { PlatformStaff } from "./types";

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function fetchPlatformStaff(): Promise<PlatformStaff[]> {
  const { data, error } = await client()
    .from("users_profile")
    .select("id,full_name,email,status,platform_role,invited_at,last_login_at")
    .not("platform_role", "is", null)
    .order("invited_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformStaff[];
}

export async function invitePlatformStaff(input: { fullName: string; email: string }) {
  await invokePlatformStaff({ full_name: input.fullName, email: input.email, role: "backend_staff" });
}

export async function deletePlatformStaff(id: string) {
  await invokePlatformStaff({ action: "delete", staff_id: id });
}

async function invokePlatformStaff(body: Record<string, unknown>) {
  const { data, error } = await client().functions.invoke("invite-platform-staff", { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const payload = await response.clone().json() as { error?: unknown };
        if (typeof payload.error === "string" && payload.error.trim()) {
          throw new Error(payload.error);
        }
      } catch (responseError) {
        if (responseError instanceof Error && responseError.message !== "Unexpected end of JSON input") {
          throw responseError;
        }
      }
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
}

export async function updatePlatformStaffStatus(id: string, status: "active" | "inactive") {
  const { error } = await client()
    .from("users_profile")
    .update({ status })
    .eq("id", id)
    .eq("platform_role", "backend_staff");
  if (error) throw new Error(error.message);
}
