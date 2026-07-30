import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);
    const url = requiredEnv("SUPABASE_URL");
    const caller = createClient(url, requiredEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const service = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: userData } = await caller.auth.getUser();
    if (!userData.user) return json({ error: "Authentication required" }, 401);
    const { data: access } = await caller.rpc("get_current_subscription_access");
    if (!access?.company_id || !access.is_admin) {
      return json({ error: "Company admin access required" }, 403);
    }
    const { data: subscription } = await service
      .from("company_subscriptions")
      .select("razorpay_subscription_id, status")
      .eq("company_id", access.company_id)
      .single();
    if (!subscription?.razorpay_subscription_id || subscription.status !== "active") {
      return json({ error: "No active paid subscription was found" }, 409);
    }

    const credentials = btoa(
      `${requiredEnv("RAZORPAY_KEY_ID")}:${requiredEnv("RAZORPAY_KEY_SECRET")}`,
    );
    const response = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${subscription.razorpay_subscription_id}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancel_at_cycle_end: 1 }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.description ?? "Razorpay rejected cancellation");
    }

    await service
      .from("company_subscriptions")
      .update({ cancel_at_period_end: true })
      .eq("company_id", access.company_id);

    return json({ scheduled: true });
  } catch (error) {
    console.error("Subscription cancellation failed", error);
    return json(
      { error: error instanceof Error ? error.message : "Cancellation failed" },
      500,
    );
  }
});

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
