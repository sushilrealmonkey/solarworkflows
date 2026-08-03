import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type AuthorizationPayload = {
  razorpay_payment_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);

    const caller = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_ANON_KEY"),
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Authentication required" }, 401);
    }

    const { data: access, error: accessError } = await caller.rpc(
      "get_current_subscription_access",
    );
    if (accessError || !access?.company_id || !access.is_admin) {
      return json({ error: "Company admin access required" }, 403);
    }

    const body = await request.json() as AuthorizationPayload;
    if (
      !validProviderId(body.razorpay_payment_id, "pay_") ||
      !validProviderId(body.razorpay_subscription_id, "sub_") ||
      !validSignature(body.razorpay_signature)
    ) {
      return json({ error: "Invalid authorization response" }, 400);
    }

    const service = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const { data: subscription, error: subscriptionError } = await service
      .from("company_subscriptions")
      .select("razorpay_subscription_id")
      .eq("company_id", access.company_id)
      .single();
    if (
      subscriptionError ||
      subscription?.razorpay_subscription_id !== body.razorpay_subscription_id
    ) {
      return json({ error: "Subscription does not belong to this company" }, 403);
    }

    const message =
      `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`;
    const verified = await verifyHmac(
      message,
      body.razorpay_signature!,
      requiredEnv("RAZORPAY_KEY_SECRET"),
    );
    if (!verified) return json({ error: "Invalid payment signature" }, 401);

    return json({ verified: true });
  } catch (error) {
    console.error("Razorpay authorization verification failed", error);
    return json({ error: "Authorization verification failed" }, 500);
  }
});

async function verifyHmac(message: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexBytes(signature),
    new TextEncoder().encode(message),
  );
}

function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function validProviderId(value: string | undefined, prefix: string) {
  return typeof value === "string" &&
    value.startsWith(prefix) &&
    /^[A-Za-z0-9_]+$/.test(value) &&
    value.length <= 64;
}

function validSignature(value: string | undefined) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
