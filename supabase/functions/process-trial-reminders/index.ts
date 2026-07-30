import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type TrialRow = {
  company_id: string;
  trial_ends_at: string;
  companies: {
    company_name: string | null;
    owner_email: string | null;
  } | null;
};

type OwnerCandidate = {
  id: string;
  auth_user_id: string;
  email: string | null;
  full_name: string | null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-secret") !== requiredEnv("TRIAL_REMINDER_WORKER_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const service = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const now = Date.now();
  const { data: trials, error } = await service
    .from("company_subscriptions")
    .select("company_id, trial_ends_at, companies(company_name, owner_email)")
    .eq("status", "trialing")
    .not("trial_ends_at", "is", null)
    .lte("trial_ends_at", new Date(now + 8 * 86400000).toISOString());
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const trial of (trials ?? []) as unknown as TrialRow[]) {
    const endsAt = new Date(trial.trial_ends_at).getTime();
    const days = Math.max(0, Math.ceil((endsAt - now) / 86400000));
    const milestone = days <= 0 ? "expired" : days <= 1 ? "day_1" : days <= 3 ? "day_3" : days <= 7 ? "day_7" : null;
    if (!milestone) continue;

    const { data: ownerCandidates } = await service
      .from("users_profile")
      .select("id, auth_user_id, email, full_name")
      .eq("company_id", trial.company_id)
      .not("auth_user_id", "is", null)
      .eq("status", "active");
    let owner: OwnerCandidate | null = null;
    for (const candidate of (ownerCandidates ?? []) as OwnerCandidate[]) {
      const { data: adminRole } = await service
        .from("user_roles")
        .select("roles!inner(role_key)")
        .eq("user_profile_id", candidate.id)
        .eq("roles.role_key", "admin")
        .limit(1)
        .maybeSingle();
      if (adminRole) {
        owner = candidate;
        break;
      }
    }
    const email = owner?.email ?? trial.companies?.owner_email;
    if (!owner?.auth_user_id || !email) continue;

    const { error: claimError } = await service
      .from("subscription_notification_state")
      .insert({
        company_id: trial.company_id,
        user_id: owner.auth_user_id,
        milestone,
      });
    if (claimError?.code === "23505") continue;
    if (claimError) {
      console.error("Reminder claim failed", claimError.message);
      continue;
    }

    try {
      await sendReminderEmail({
        email,
        name: owner.full_name ?? "there",
        company: trial.companies?.company_name ?? "your company",
        days,
      });
      sent += 1;
    } catch (sendError) {
      console.error("Trial reminder email failed", sendError);
      await service
        .from("subscription_notification_state")
        .delete()
        .eq("company_id", trial.company_id)
        .eq("user_id", owner.auth_user_id)
        .eq("milestone", milestone);
    }
  }

  return json({ processed: trials?.length ?? 0, sent });
});

async function sendReminderEmail(input: {
  email: string;
  name: string;
  company: string;
  days: number;
}) {
  const expired = input.days === 0;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requiredEnv("TRIAL_REMINDER_FROM_EMAIL"),
      to: [input.email],
      subject: expired
        ? "Your Bizlee trial has ended"
        : `${input.days} day${input.days === 1 ? "" : "s"} left in your Bizlee trial`,
      html: `<p>Hi ${escapeHtml(input.name)},</p><p>${escapeHtml(input.company)} ${
        expired
          ? "is now in read-only mode."
          : `has ${input.days} day${input.days === 1 ? "" : "s"} remaining in its Premium trial.`
      }</p><p><a href="${requiredEnv("APP_BASE_URL")}/billing/plans">Choose a Bizlee plan</a> to continue using the workspace.</p>`,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
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
