import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type SendSmsHookPayload = {
  user?: { phone?: string | null };
  sms?: { otp?: string | number | null };
};

const BLACK_SMS_ENDPOINT = "https://blacksms.in/sms";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawPayload = await request.text();
    const payload = verifySupabaseHook(rawPayload, request.headers);
    const mobile = normalizeIndianMobile(payload.user?.phone);
    const otp = String(payload.sms?.otp ?? "").trim();

    if (!mobile || !otp || !/^\d{6}$/.test(otp)) {
      return jsonResponse({ error: "Invalid Send SMS hook payload" }, 400);
    }

    const apiKey = requireEnv("BLACKSMS_API_KEY");
    const senderId = requireEnv("BLACKSMS_SENDER_ID");

    const providerPayload = {
      sender_id: senderId,
      variables_values: otp,
      numbers: mobile.slice(2),
    };

    const providerResponse = await fetch(BLACK_SMS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(providerPayload),
      signal: AbortSignal.timeout(4_000),
    });

    const responseText = await providerResponse.text();

    if (!providerResponse.ok || providerReportedFailure(responseText)) {
      console.error("Black SMS rejected the OTP message", {
        status: providerResponse.status,
      });
      return jsonResponse({ error: "SMS delivery failed" }, 502);
    }

    return jsonResponse({}, 200);
  } catch (error) {
    console.error("Send SMS hook failed", safeErrorMessage(error));
    return jsonResponse({ error: "SMS delivery failed" }, 500);
  }
});

function verifySupabaseHook(
  rawPayload: string,
  requestHeaders: Headers,
): SendSmsHookPayload {
  const configuredSecret = requireEnv("SEND_SMS_HOOK_SECRET");
  const webhook = new Webhook(configuredSecret.replace(/^v1,whsec_/, ""));

  return webhook.verify(
    rawPayload,
    Object.fromEntries(requestHeaders.entries()),
  ) as SendSmsHookPayload;
}

function normalizeIndianMobile(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return /^91[6-9]\d{9}$/.test(digits) ? digits : null;
}

function providerReportedFailure(responseText: string) {
  if (!responseText.trim()) return false;

  try {
    const body = JSON.parse(responseText) as Record<string, unknown>;
    return (
      body.success === false ||
      body.status === false ||
      body.status === 0 ||
      body.status === "0" ||
      Boolean(body.error)
    );
  } catch {
    return false;
  }
}

function requireEnv(name: string) {
  const value = optionalEnv(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function optionalEnv(name: string) {
  return Deno.env.get(name)?.trim() || null;
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
