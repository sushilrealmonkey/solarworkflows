import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "https://esm.sh/pdf-lib@1.17.1";
import {
  isTerminalCheckoutEvent,
  subscriptionWebhookAction,
  type SubscriptionWebhookAction,
} from "./subscription-state.ts";
import {
  isGstInvoice,
  splitInclusiveGst,
  type RazorpayInvoice,
} from "./invoice.ts";

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
  order_id?: string;
  email?: string;
  contact?: string;
  description?: string;
  method?: string;
  status?: string;
  captured?: boolean;
  tax?: number;
  notes?: Record<string, string>;
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

  const breakdown = splitInclusiveGst(gross!);
  const [companyResult, buyerResult, razorpayInvoice] = await Promise.all([
    service
      .from("companies")
      .select("company_name")
      .eq("id", input.companyId)
      .single(),
    service
      .from("organization_settings")
      .select("company_name, gst_number, address, organizations!inner(company_id)")
      .eq("organizations.company_id", input.companyId)
      .maybeSingle(),
    input.payment?.invoice_id
      ? fetchRazorpayInvoice(input.payment.invoice_id)
      : Promise.resolve(null),
  ]);
  if (companyResult.error) throw new Error(companyResult.error.message);
  if (buyerResult.error) throw new Error(buyerResult.error.message);

  const company = companyResult.data;
  const buyer = buyerResult.data;
  const providerInvoiceIsUsable = Boolean(
    razorpayInvoice &&
    isGstInvoice(razorpayInvoice) &&
    razorpayInvoice.gross_amount === gross &&
    razorpayInvoice.taxable_amount === breakdown.taxableAmountPaise &&
    razorpayInvoice.tax_amount === breakdown.gstAmountPaise &&
    (!razorpayInvoice.payment_id || razorpayInvoice.payment_id === paymentId),
  );

  const sellerGstin = requiredEnv("BILLING_GSTIN").toUpperCase();
  const buyerGstin = buyer?.gst_number?.trim().toUpperCase() ?? null;
  const intraState = Boolean(
    buyerGstin &&
    /^\d{2}/.test(buyerGstin) &&
    buyerGstin.slice(0, 2) === sellerGstin.slice(0, 2),
  );
  const cgst = intraState
    ? Math.floor(breakdown.gstAmountPaise / 2)
    : 0;
  const sgst = intraState ? breakdown.gstAmountPaise - cgst : 0;
  const invoiceRecord = {
    company_id: input.companyId,
    razorpay_payment_id: paymentId,
    razorpay_subscription_id: input.subscription.id!,
    razorpay_invoice_id: input.payment?.invoice_id ?? null,
    invoice_source: providerInvoiceIsUsable ? "razorpay" : "custom",
    razorpay_invoice_number: providerInvoiceIsUsable
      ? razorpayInvoice?.invoice_number?.trim() || null
      : null,
    razorpay_invoice_url: providerInvoiceIsUsable
      ? razorpayInvoice?.short_url?.trim() || null
      : null,
    plan_key: input.planKey,
    billing_period: input.billingPeriod,
    gross_amount_paise: gross,
    taxable_amount_paise: breakdown.taxableAmountPaise,
    gst_amount_paise: breakdown.gstAmountPaise,
    cgst_amount_paise: cgst,
    sgst_amount_paise: sgst,
    igst_amount_paise: intraState ? 0 : breakdown.gstAmountPaise,
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
      invoice_source: existing.invoice_source ?? "custom",
      razorpay_invoice_number: existing.razorpay_invoice_number ?? null,
      razorpay_invoice_url: existing.razorpay_invoice_url ?? null,
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

async function fetchRazorpayInvoice(invoiceId: string): Promise<RazorpayInvoice | null> {
  if (!/^inv_[A-Za-z0-9]+$/.test(invoiceId)) return null;

  try {
    return await razorpayRequest(
      `/v1/invoices/${encodeURIComponent(invoiceId)}`,
      undefined,
      "GET",
    ) as RazorpayInvoice;
  } catch (error) {
    // A provider invoice is an enhancement. If it cannot be fetched, keep the
    // payment traceable and use the branded PDF fallback below.
    console.error("Unable to fetch Razorpay invoice", {
      invoiceId,
      message: safeMessage(error),
    });
    return null;
  }
}

async function razorpayRequest(
  path: string,
  body?: Record<string, unknown>,
  method = "POST",
) {
  const credentials = btoa(
    `${requiredEnv("RAZORPAY_KEY_ID")}:${requiredEnv("RAZORPAY_KEY_SECRET")}`,
  );
  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error?.description === "string"
        ? payload.error.description
        : `Razorpay invoice request failed (${response.status})`,
    );
  }
  return payload as Record<string, unknown>;
}

async function renderSubscriptionInvoice(invoice: Record<string, unknown>) {
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.025, 0.09, 0.25);
  const orange = rgb(0.96, 0.38, 0.05);
  const softOrange = rgb(1, 0.96, 0.92);
  const softBlue = rgb(0.95, 0.97, 0.99);
  const border = rgb(0.84, 0.87, 0.91);
  const muted = rgb(0.38, 0.43, 0.5);
  const money = (paise: unknown) =>
    `Rs. ${(Number(paise) / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const text = (
    value: unknown,
    x: number,
    y: number,
    size = 10,
    font = regular,
    color = navy,
    align: "left" | "right" = "left",
  ) => drawAlignedText(page, value, x, y, size, font, color, align);
  const label = (value: string, x: number, y: number) =>
    text(value, x, y, 8, bold, muted);
  const value = (item: unknown, x: number, y: number, size = 10) =>
    drawFittedText(page, item, x, y, 145, size, regular, navy);

  const [realmonkeyBytes, bizleeBytes] = await Promise.all([
    readAsset("assets/realmonkey-logo.png"),
    readAsset("assets/bizlee-logo.png"),
  ]);
  const realmonkeyLogo = realmonkeyBytes
    ? await document.embedPng(realmonkeyBytes)
    : null;
  const bizleeLogo = bizleeBytes ? await document.embedPng(bizleeBytes) : null;

  page.drawRectangle({ x: 0, y: 830, width: 595.28, height: 12, color: orange });
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 6, color: orange });
  if (realmonkeyLogo) {
    drawLogo(page, realmonkeyLogo, 42, 775, 208, 42);
  } else {
    text(invoice.seller_legal_name, 42, 795, 18, bold);
  }
  text("TAX INVOICE", 553, 805, 20, bold, navy, "right");
  text("Bizlee subscription · GST @ 18% included", 553, 784, 8, regular, muted, "right");
  page.drawLine({ start: { x: 42, y: 755 }, end: { x: 553, y: 755 }, thickness: 1, color: border });

  label("Invoice number", 42, 724);
  value(invoice.invoice_number, 42, 706);
  label("Invoice date", 205, 724);
  value(formatDate(new Date(String(invoice.issued_at))), 205, 706);
  label("Payment reference", 370, 724);
  drawFittedText(page, invoice.razorpay_payment_id, 370, 706, 183, 9, regular, navy);

  page.drawRectangle({ x: 42, y: 618, width: 511, height: 58, color: softBlue });
  text("BILLED TO", 56, 658, 8, bold, muted);
  drawFittedText(page, invoice.buyer_legal_name, 56, 638, 270, 13, bold, navy);
  if (invoice.buyer_gstin) text(`GSTIN: ${invoice.buyer_gstin}`, 56, 624, 8, regular, muted);
  label("FROM", 370, 658);
  drawFittedText(page, invoice.seller_legal_name, 370, 640, 165, 9, bold, navy);
  drawFittedText(page, `GSTIN: ${invoice.seller_gstin}`, 370, 626, 165, 8, regular, muted);

  text("ITEM", 42, 584, 8, bold, muted);
  text("TAXABLE VALUE", 340, 584, 8, bold, muted);
  text("GST", 470, 584, 8, bold, muted);
  page.drawRectangle({ x: 42, y: 494, width: 511, height: 76, color: softOrange });
  if (bizleeLogo) drawLogo(page, bizleeLogo, 56, 529, 88, 26);
  text(
    `${invoice.plan_key === "starter" ? "Bizlee Core" : "Bizlee Pro"} subscription`,
    156,
    548,
    10,
    bold,
  );
  text("Product by Realmonkey", 156, 532, 8, regular, muted);
  text(formatBillingPeriod(invoice.billing_period), 156, 516, 8, regular, muted);
  text(money(invoice.taxable_amount_paise), 340, 534, 10);
  text("18%", 470, 534, 10);

  label("Taxable amount", 340, 458);
  text(money(invoice.taxable_amount_paise), 470, 458, 10);
  label("GST @ 18%", 340, 436);
  text(money(invoice.gst_amount_paise), 470, 436, 10);
  let taxY = 414;
  if (Number(invoice.cgst_amount_paise) > 0) {
    label("CGST @ 9%", 340, taxY);
    text(money(invoice.cgst_amount_paise), 470, taxY, 9);
    taxY -= 20;
    label("SGST @ 9%", 340, taxY);
    text(money(invoice.sgst_amount_paise), 470, taxY, 9);
  } else {
    label("IGST @ 18%", 340, taxY);
    text(money(invoice.igst_amount_paise), 470, taxY, 9);
  }
  page.drawLine({ start: { x: 340, y: 362 }, end: { x: 553, y: 362 }, thickness: 1, color: border });
  text("TOTAL PAID", 340, 334, 12, bold);
  text(money(invoice.gross_amount_paise), 553, 334, 12, bold, navy, "right");
  text("Payment status: PAID", 42, 416, 9, bold, rgb(0.05, 0.45, 0.28));
  text(`SAC: ${invoice.sac_code ?? "-"}`, 42, 398, 9, regular, muted);
  if (invoice.razorpay_invoice_number) {
    text(`Razorpay invoice: ${invoice.razorpay_invoice_number}`, 42, 380, 8, regular, muted);
  }

  page.drawRectangle({ x: 42, y: 90, width: 511, height: 74, color: softBlue });
  text("ISSUER DETAILS", 56, 143, 8, bold, muted);
  drawFittedText(page, invoice.seller_address, 56, 124, 465, 8, regular, navy);
  text("This computer-generated invoice is issued against the captured Razorpay payment.", 56, 106, 8, regular, muted);
  text("Thank you for choosing Bizlee.", 553, 28, 8, bold, navy, "right");
  return await document.save();
}

function drawLogo(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) {
  const dimensions = image.scaleToFit(maxWidth, maxHeight);
  page.drawImage(image, {
    x,
    y: y + maxHeight - dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
  });
}

async function readAsset(path: string) {
  try {
    return await Deno.readFile(new URL(`./${path}`, import.meta.url));
  } catch (error) {
    console.error("Unable to load invoice asset", { path, message: safeMessage(error) });
    return null;
  }
}

function drawFittedText(
  page: PDFPage,
  item: unknown,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  align: "left" | "right" = "left",
) {
  const content = safePdfText(item);
  let fittedSize = size;
  while (fittedSize > 6 && font.widthOfTextAtSize(content, fittedSize) > maxWidth) {
    fittedSize -= 0.5;
  }
  drawAlignedText(page, content, x, y, fittedSize, font, color, align);
}

function drawAlignedText(
  page: PDFPage,
  value: unknown,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  align: "left" | "right" = "left",
) {
  const content = safePdfText(value);
  const textX = align === "right"
    ? x - font.widthOfTextAtSize(content, size)
    : x;
  page.drawText(content, { x: textX, y, size, font, color });
}

function safePdfText(value: unknown) {
  return String(value ?? "-").replace(/[^\x20-\x7E]/g, " ");
}

function formatBillingPeriod(value: unknown) {
  return String(value ?? "monthly").toLowerCase() === "yearly"
    ? "Annual billing"
    : "Monthly billing";
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
