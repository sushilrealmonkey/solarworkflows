import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.1";

type ClaimedPush = { delivery_id: string; company_id: string; device_id: string; expo_push_token: string; title: string; message: string; destination_route: string; attempt_count: number };
type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-secret") !== requireEnv("MOBILE_PUSH_WORKER_SECRET")) return json({ error: "Unauthorized" }, 401);
  const service = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const limit = boundedInteger(new URL(request.url).searchParams.get("limit"), 100, 1, 100);
  const { data, error } = await service.rpc("claim_mobile_push_delivery_batch", { p_limit: limit });
  if (error) { console.error("Push claim failed", error.message); return json({ error: "Could not claim mobile push deliveries" }, 500); }
  const claimed = (data ?? []) as ClaimedPush[];
  if (claimed.length === 0) return json({ claimed: 0, sent: 0, retried: 0, cancelled: 0 });

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST", headers: { "accept": "application/json", "accept-encoding": "gzip, deflate", "content-type": "application/json" },
    body: JSON.stringify(claimed.map((delivery) => ({ to: delivery.expo_push_token, title: delivery.title.slice(0, 120), body: delivery.message.slice(0, 1000), sound: "default", channelId: "default", data: { destinationRoute: delivery.destination_route, deliveryId: delivery.delivery_id } }))),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { data?: ExpoTicket[] } | null;
  if (!response.ok || !Array.isArray(payload?.data) || payload.data.length !== claimed.length) {
    await Promise.all(claimed.map((delivery) => recordFailure(service, delivery, `expo_http_${response.status}`, "Expo push service rejected the batch", true)));
    return json({ claimed: claimed.length, sent: 0, retried: claimed.length, cancelled: 0 }, 502);
  }

  let sent = 0; let retried = 0; let cancelled = 0;
  for (let index = 0; index < claimed.length; index += 1) {
    const delivery = claimed[index]; const ticket = payload.data[index];
    if (ticket.status === "ok") {
      const { error: updateError } = await service.from("mobile_push_deliveries").update({ status: "sent", expo_ticket_id: ticket.id, sent_at: new Date().toISOString(), locked_at: null, failure_code: null, failure_message: null, updated_at: new Date().toISOString() }).eq("id", delivery.delivery_id).eq("company_id", delivery.company_id);
      if (updateError) console.error("Push completion failed", delivery.delivery_id, updateError.message); else sent += 1;
      continue;
    }
    const code = ticket.details?.error ?? "expo_ticket_error"; const invalid = code === "DeviceNotRegistered";
    if (invalid) await service.from("mobile_devices").update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.device_id).eq("company_id", delivery.company_id);
    const retry = !invalid && delivery.attempt_count < 5; await recordFailure(service, delivery, code, ticket.message ?? "Expo push delivery failed", retry);
    if (retry) retried += 1; else cancelled += 1;
  }
  return json({ claimed: claimed.length, sent, retried, cancelled });
});

async function recordFailure(service: ReturnType<typeof createClient>, delivery: ClaimedPush, code: string, message: string, retry: boolean) {
  const delayMinutes = Math.min(2 ** Math.max(delivery.attempt_count - 1, 0), 60);
  const status = retry ? "queued" : "cancelled";
  const { error } = await service.from("mobile_push_deliveries").update({ status, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), locked_at: null, failure_code: code.slice(0, 100), failure_message: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", delivery.delivery_id).eq("company_id", delivery.company_id);
  if (error) console.error("Could not record push failure", delivery.delivery_id, error.message);
}
function requireEnv(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function boundedInteger(value: string | null, fallback: number, min: number, max: number) { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback; }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
