import { supabase } from "../../services/supabaseClient";
import type { DemoBooking, DemoBookingStatus } from "./types";

const demoBookingSelect =
  "id,company_id,name,company,mobile,current_workflow,primary_priority,current_software,purchase_timeline,scheduled_for,demo_slot_label,event_id,source_url,status,created_at,updated_at,whatsapp_opt_in_at,whatsapp_opt_in_source,whatsapp_opt_in_text_version,meeting_timezone,meeting_url";

function client() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

export async function fetchDemoBookings(): Promise<DemoBooking[]> {
  const { data, error } = await client()
    .from("demo_bookings")
    .select(demoBookingSelect)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DemoBooking[];
}

export async function fetchDemoBooking(id: string): Promise<DemoBooking | null> {
  const { data, error } = await client()
    .from("demo_bookings")
    .select(demoBookingSelect)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as DemoBooking | null) ?? null;
}

export async function updateDemoBookingStatus(
  id: string,
  status: DemoBookingStatus,
) {
  const { data, error } = await client()
    .from("demo_bookings")
    .update({ status })
    .eq("id", id)
    .select("id,status,updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Demo booking was not found or could not be updated.");
  }

  return data as Pick<DemoBooking, "id" | "status" | "updated_at">;
}
