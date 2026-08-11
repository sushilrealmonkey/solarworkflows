import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type ClaimedNotification = {
  id: string;
  company_id: string;
  subscription_id: string;
  attempt_count: number;
};

type TrialSubscription = {
  id: string;
  company_id: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
  companies: {
    company_name: string | null;
    owner_name: string | null;
    owner_email: string | null;
    owner_phone: string | null;
  } | null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-secret") !== requiredEnv("TRIAL_SIGNUP_WORKER_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Fail before claiming work so missing delivery configuration leaves every
  // outbox row pending and automatically recoverable once secrets are added.
  requiredEnv("RESEND_API_KEY");
  requiredEnv("TRIAL_REMINDER_FROM_EMAIL");

  const service = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const { data: claims, error: claimError } = await service.rpc(
    "claim_trial_signup_notifications",
    { batch_size: 25 },
  );
  if (claimError) return json({ error: claimError.message }, 500);

  let sent = 0;
  let failed = 0;
  const recipients = await resolveRecipients(service);

  for (const claim of (claims ?? []) as ClaimedNotification[]) {
    if (recipients.length === 0) {
      await releaseClaim(service, claim, "No trial signup notification recipient is configured");
      failed += 1;
      continue;
    }

    const { data, error } = await service
      .from("company_subscriptions")
      .select(
        "id, company_id, trial_started_at, trial_ends_at, created_at, companies(company_name, owner_name, owner_email, owner_phone)",
      )
      .eq("id", claim.subscription_id)
      .eq("company_id", claim.company_id)
      .eq("status", "trialing")
      .maybeSingle();

    if (error || !data) {
      await releaseClaim(
        service,
        claim,
        error?.message ?? "Trial subscription was not found",
      );
      failed += 1;
      continue;
    }

    try {
      await sendTrialSignupEmail(recipients, data as unknown as TrialSubscription);
      const { error: updateError } = await service
        .from("trial_signup_notification_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", claim.id)
        .eq("status", "processing");
      if (updateError) throw updateError;
      sent += 1;
    } catch (sendError) {
      console.error("Trial signup notification failed", sendError);
      await releaseClaim(service, claim, errorMessage(sendError));
      failed += 1;
    }
  }

  return json({ claimed: claims?.length ?? 0, sent, failed });
});

async function resolveRecipients(
  service: ReturnType<typeof createClient>,
): Promise<string[]> {
  const configured = (
    Deno.env.get("TRIAL_SIGNUP_NOTIFICATION_EMAIL") ??
    Deno.env.get("SUPER_ADMIN_EMAIL") ??
    ""
  )
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return [...new Set(configured)];

  const { data, error } = await service
    .from("users_profile")
    .select("email")
    .eq("is_super_admin", true)
    .eq("status", "active")
    .not("email", "is", null);
  if (error) throw new Error(`Could not resolve super-admin email: ${error.message}`);

  return [...new Set(
    (data ?? [])
      .map((profile) => profile.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email)),
  )];
}

async function sendTrialSignupEmail(
  recipients: string[],
  subscription: TrialSubscription,
) {
  const company = subscription.companies;
  const companyName = company?.company_name ?? "New workspace";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requiredEnv("TRIAL_REMINDER_FROM_EMAIL"),
      to: recipients,
      subject: `New Bizlee trial signup: ${companyName}`,
      html: [
        "<h2>New trial signup</h2>",
        `<p><strong>Company:</strong> ${escapeHtml(companyName)}</p>`,
        `<p><strong>Name:</strong> ${escapeHtml(company?.owner_name ?? "Not provided")}</p>`,
        `<p><strong>Email:</strong> ${escapeHtml(company?.owner_email ?? "Not provided")}</p>`,
        `<p><strong>Phone:</strong> ${escapeHtml(company?.owner_phone ?? "Not provided")}</p>`,
        `<p><strong>Trial started:</strong> ${formatDate(subscription.trial_started_at ?? subscription.created_at)}</p>`,
        `<p><strong>Trial ends:</strong> ${formatDate(subscription.trial_ends_at)}</p>`,
      ].join(""),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

async function releaseClaim(
  service: ReturnType<typeof createClient>,
  claim: ClaimedNotification,
  message: string,
) {
  const { error } = await service
    .from("trial_signup_notification_outbox")
    .update({
      status: claim.attempt_count >= 5 ? "failed" : "pending",
      last_error: message.slice(0, 1000),
    })
    .eq("id", claim.id)
    .eq("status", "processing");
  if (error) console.error("Could not release trial signup notification", error.message);
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown delivery error";
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
