import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1";
import {
  isTerminalCheckoutEvent,
  subscriptionWebhookAction,
  type SubscriptionWebhookAction,
} from "./subscription-state.ts";

type RazorpayEntity = {
  id?: string;
  plan_id?: string;
  status?: string;
  current_start?: number;
  current_end?: number;
  ended_at?: number;
  notes?: {
    company_id?: string;
    plan_key?: string;
    billing_period?: string;
  };
};

type RazorpayPaymentEntity = {
  id?: string;
  amount?: number;
  currency?: string;
  invoice_id?: string;
  created_at?: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";

  try {
    if (!eventId || !(await validSignature(rawBody, signature))) {
      return json({ error: "Invalid webhook signature" }, 401);
    }

    const service = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const payload = JSON.parse(rawBody);
    const eventType = String(payload.event ?? "");

    const { error: eventError } = await service
      .from("subscription_webhook_events")
      .insert({
        provider_event_id: eventId,
        event_type: eventType,
        payload,
      });
    if (eventError?.code === "23505") {
      const { data: existingEvent } = await service
        .from("subscription_webhook_events")
        .select("processed_at")
        .eq("provider_event_id", eventId)
        .single();
      if (existingEvent?.processed_at) return json({ received: true });
    }
    if (eventError && eventError.code !== "23505") {
      throw new Error(eventError.message);
    }

    const entity = payload?.payload?.subscription?.entity as RazorpayEntity | undefined;
    const companyId = entity?.notes?.company_id;
    const resolvedPlan = resolvePlan(entity);
    const planKey = resolvedPlan?.planKey ?? entity?.notes?.plan_key;
    const billingPeriod =
      resolvedPlan?.billingPeriod ?? entity?.notes?.billing_period ?? "monthly";
    if (!entity?.id || !companyId || !["starter", "premium"].includes(planKey ?? "")) {
      throw new Error("Webhook subscription metadata is incomplete");
    }

    const { data: currentSubscription, error: subscriptionError } = await service
      .from("company_subscriptions")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("razorpay_subscription_id", entity.id)
      .maybeSingle();
    if (subscriptionError) throw new Error(subscriptionError.message);
    if (!currentSubscription) {
      throw new Error("Webhook subscription did not match a company");
    }

    const webhookAction = subscriptionWebhookAction(
      eventType,
      currentSubscription.status,
    );
    const patch = subscriptionPatch(
      eventType,
      entity,
      planKey!,
      billingPeriod,
      webhookAction,
    );
    const { data: updated, error: updateError } = await service
      .from("company_subscriptions")
      .update(patch)
      .eq("id", currentSubscription.id)
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) throw new Error("Webhook subscription did not match a company");

    if (eventType === "subscription.charged") {
      const payment = payload?.payload?.payment?.entity as
        | RazorpayPaymentEntity
        | undefined;
      await createAndSendSubscriptionInvoice(service, {
        companyId,
        eventId,
        subscription: entity,
        payment,
        planKey: planKey!,
        billingPeriod,
      });
    }

    if (
      webhookAction !== "preserve_trial" &&
      ["subscription.pending", "subscription.halted", "payment.failed"].includes(eventType)
    ) {
      const payment = payload?.payload?.payment?.entity as
        | RazorpayPaymentEntity
        | undefined;
      const { error: queueError } = await service.rpc(
        "queue_notification_event",
        {
          p_company_id: companyId,
          p_event_type: "subscription_action_required",
          p_source_type: "razorpay_webhook",
          p_source_record_id: entity.id,
          p_idempotency_key: `razorpay:${eventId}`,
          p_payload: {
            amount: formatRupees(payment?.amount),
            attempt_date: formatDate(new Date()),
            reference: payment?.id ?? eventId,
          },
          p_notification_key: "subscription_action_required",
          p_scheduled_at: new Date().toISOString(),
        },
      );
      if (queueError) {
        throw new Error(`Could not queue subscription notification: ${queueError.message}`);
      }
    }

    await service
      .from("subscription_webhook_events")
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("provider_event_id", eventId);

    return json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook failed", safeMessage(error));
    return json({ error: "Webhook processing failed" }, 500);
  }
});

function subscriptionPatch(
  eventType: string,
  entity: RazorpayEntity,
  planKey: string,
  billingPeriod: string,
  action: SubscriptionWebhookAction,
) {
  if (action === "preserve_trial") {
    return {
      status: "trialing",
      ...(isTerminalCheckoutEvent(eventType)
        ? { razorpay_subscription_id: null }
        : {}),
    };
  }

  const base: Record<string, unknown> = {
    plan_key: planKey,
    billing_period: billingPeriod,
    current_period_started_at: unixDate(entity.current_start),
    current_period_ends_at: unixDate(entity.current_end),
  };

  if (action === "activate") {
    return { ...base, status: "active", cancel_at_period_end: false };
  }
  if (action === "past_due") {
    return { ...base, status: "past_due" };
  }
  if (action === "suspend") return { ...base, status: "suspended" };
  if (action === "cancel") {
    return {
      ...base,
      status: "cancelled",
      current_period_ends_at: unixDate(entity.ended_at ?? entity.current_end),
    };
  }
  return base;
}

async function createAndSendSubscriptionInvoice(
  service: ReturnType<typeof createClient>,
  input: {
    companyId: string;
    eventId: string;
    subscription: RazorpayEntity;
    payment?: RazorpayPaymentEntity;
    planKey: string;
    billingPeriod: string;
  },
) {
  const paymentId = input.payment?.id;
  const gross = input.payment?.amount;
  if (
    !paymentId ||
    !Number.isInteger(gross) ||
    (gross ?? 0) <= 0 ||
    (input.payment?.currency ?? "INR") !== "INR"
  ) {
    throw new Error("Charged subscription payment metadata is incomplete");
  }

  const taxable = Math.round((gross! * 100) / 118);
  const gst = gross! - taxable;
  const { data: company } = await service
    .from("companies")
    .select("company_name")
    .eq("id", input.companyId)
    .single();
  const { data: buyer } = await service
    .from("organization_settings")
    .select("company_name, gst_number, address, organizations!inner(company_id)")
    .eq("organizations.company_id", input.companyId)
    .maybeSingle();

  const sellerGstin = requiredEnv("BILLING_GSTIN").toUpperCase();
  const buyerGstin = buyer?.gst_number?.trim().toUpperCase() ?? null;
  const intraState = Boolean(
    buyerGstin &&
    /^\d{2}/.test(buyerGstin) &&
    buyerGstin.slice(0, 2) === sellerGstin.slice(0, 2),
  );
  const cgst = intraState ? Math.floor(gst / 2) : 0;
  const sgst = intraState ? gst - cgst : 0;
  const invoiceRecord = {
    company_id: input.companyId,
    razorpay_payment_id: paymentId,
    razorpay_subscription_id: input.subscription.id!,
    razorpay_invoice_id: input.payment?.invoice_id ?? null,
    plan_key: input.planKey,
    billing_period: input.billingPeriod,
    gross_amount_paise: gross,
    taxable_amount_paise: taxable,
    gst_amount_paise: gst,
    cgst_amount_paise: cgst,
    sgst_amount_paise: sgst,
    igst_amount_paise: intraState ? 0 : gst,
    seller_legal_name: requiredEnv("BILLING_LEGAL_NAME"),
    seller_gstin: sellerGstin,
    seller_address: requiredEnv("BILLING_ADDRESS"),
    buyer_legal_name: buyer?.company_name ?? company?.company_name ?? "Tenant",
    buyer_gstin: buyerGstin,
    buyer_address: buyer?.address ?? null,
    sac_code: Deno.env.get("BILLING_SAC_CODE")?.trim() || "998314",
    paid_at: unixDate(input.payment?.created_at) ?? new Date().toISOString(),
  };
  const { data: inserted, error: insertError } = await service
    .from("subscription_invoices")
    .insert(invoiceRecord)
    .select("*")
    .maybeSingle();
  if (insertError?.code !== "23505" && insertError) {
    throw new Error(insertError.message);
  }
  const { data: existing } = inserted
    ? { data: inserted }
    : await service
      .from("subscription_invoices")
      .select("*")
      .eq("razorpay_payment_id", paymentId)
      .single();
  if (!existing) throw new Error("Subscription invoice could not be created");

  let pdfPath = existing.pdf_path as string | null;
  if (!pdfPath) {
    pdfPath = `${input.companyId}/${existing.invoice_number}.pdf`;
    const pdf = await renderSubscriptionInvoice(existing);
    const { error: uploadError } = await service.storage
      .from(existing.pdf_bucket)
      .upload(pdfPath, pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) {
      throw new Error(uploadError.message);
    }
    const { error: pathError } = await service
      .from("subscription_invoices")
      .update({ pdf_path: pdfPath })
      .eq("id", existing.id);
    if (pathError) throw new Error(pathError.message);
  }

  const { error: queueError } = await service.rpc("queue_notification_event", {
    p_company_id: input.companyId,
    p_event_type: "subscription_payment_received",
    p_source_type: "razorpay_webhook",
    p_source_record_id: paymentId,
    p_idempotency_key: `razorpay-invoice:${paymentId}`,
    p_payload: {
      invoice_number: existing.invoice_number,
      amount: formatRupees(gross),
      payment_date: formatDate(new Date(existing.paid_at)),
      invoice_pdf_bucket: existing.pdf_bucket,
      invoice_pdf_path: pdfPath,
    },
    p_notification_key: "subscription_payment_received",
    p_scheduled_at: new Date().toISOString(),
  });
  if (queueError) throw new Error(`Could not queue invoice notification: ${queueError.message}`);
}

async function renderSubscriptionInvoice(invoice: Record<string, unknown>) {
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.025, 0.09, 0.25);
  const muted = rgb(0.38, 0.43, 0.5);
  const money = (paise: unknown) =>
    `INR ${(Number(paise) / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const text = (value: unknown, x: number, y: number, size = 10, font = regular) =>
    page.drawText(String(value ?? "-").replace(/[^\x20-\x7E]/g, " "), {
      x, y, size, font, color: navy,
    });

  page.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: navy });
  page.drawText("TAX INVOICE", { x: 390, y: 795, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(String(invoice.seller_legal_name), {
    x: 42, y: 802, size: 18, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText(`GSTIN: ${invoice.seller_gstin}`, {
    x: 42, y: 780, size: 9, font: regular, color: rgb(0.9, 0.92, 0.96),
  });
  text("Invoice number", 42, 720, 9, bold);
  text(invoice.invoice_number, 42, 703, 11);
  text("Invoice date", 230, 720, 9, bold);
  text(formatDate(new Date(String(invoice.issued_at))), 230, 703, 11);
  text("Payment reference", 400, 720, 9, bold);
  text(invoice.razorpay_payment_id, 400, 703, 8);
  page.drawLine({ start: { x: 42, y: 680 }, end: { x: 553, y: 680 }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  text("BILLED TO", 42, 650, 9, bold);
  text(invoice.buyer_legal_name, 42, 630, 13, bold);
  if (invoice.buyer_gstin) text(`GSTIN: ${invoice.buyer_gstin}`, 42, 612, 9);
  text("DESCRIPTION", 42, 555, 9, bold);
  text("TAXABLE VALUE", 340, 555, 9, bold);
  text("GST", 470, 555, 9, bold);
  page.drawRectangle({ x: 42, y: 515, width: 511, height: 30, color: rgb(0.96, 0.97, 0.98) });
  text(
    `${invoice.plan_key === "starter" ? "Bizlee Core" : "Bizlee Pro"} - ${String(invoice.billing_period)}`,
    50,
    526,
    10,
  );
  text(money(invoice.taxable_amount_paise), 340, 526, 10);
  text("18%", 470, 526, 10);
  text("Taxable amount", 340, 470, 10);
  text(money(invoice.taxable_amount_paise), 470, 470, 10);
  text("GST @ 18%", 340, 445, 10);
  text(money(invoice.gst_amount_paise), 470, 445, 10);
  let taxY = 420;
  if (Number(invoice.cgst_amount_paise) > 0) {
    text("CGST @ 9%", 340, taxY, 9);
    text(money(invoice.cgst_amount_paise), 470, taxY, 9);
    taxY -= 22;
    text("SGST @ 9%", 340, taxY, 9);
    text(money(invoice.sgst_amount_paise), 470, taxY, 9);
  } else {
    text("IGST @ 18%", 340, taxY, 9);
    text(money(invoice.igst_amount_paise), 470, taxY, 9);
  }
  page.drawLine({ start: { x: 340, y: 370 }, end: { x: 553, y: 370 }, thickness: 1, color: muted });
  text("TOTAL PAID", 340, 340, 12, bold);
  text(money(invoice.gross_amount_paise), 470, 340, 12, bold);
  text(`SAC: ${invoice.sac_code ?? "-"}`, 42, 470, 9);
  text("Payment status: PAID", 42, 445, 10, bold);
  text(String(invoice.seller_address), 42, 105, 8);
  text("This is a computer-generated invoice.", 42, 75, 8);
  return await document.save();
}

function resolvePlan(entity: RazorpayEntity | undefined) {
  const configuredPlans = [
    {
      id: Deno.env.get("RAZORPAY_STARTER_MONTHLY_PLAN_ID"),
      planKey: "starter",
      billingPeriod: "monthly",
    },
    {
      id: Deno.env.get("RAZORPAY_STARTER_YEARLY_PLAN_ID"),
      planKey: "starter",
      billingPeriod: "yearly",
    },
    {
      id: Deno.env.get("RAZORPAY_PREMIUM_MONTHLY_PLAN_ID"),
      planKey: "premium",
      billingPeriod: "monthly",
    },
    {
      id: Deno.env.get("RAZORPAY_PREMIUM_YEARLY_PLAN_ID"),
      planKey: "premium",
      billingPeriod: "yearly",
    },
  ];
  return configuredPlans.find((plan) => plan.id && plan.id === entity?.plan_id);
}

function unixDate(value?: number) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function formatRupees(amountPaise?: number) {
  if (!Number.isFinite(amountPaise)) return "Amount unavailable";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((amountPaise ?? 0) / 100);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

async function validSignature(body: string, received: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredEnv("RAZORPAY_WEBHOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
