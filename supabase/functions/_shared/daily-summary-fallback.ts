export type DailySummaryMessage = {
  headline: string;
  summary: string;
};

export type DailySummarySnapshot = {
  overdue_followups: number;
  overdue_invoices: number;
  low_stock_items: number;
  new_enquiries_today: number;
};

export type TrialSubscription = {
  status: string | null;
  trial_ends_at: string | null;
};

const TRIAL_EMPTY_SUMMARY_MESSAGES: readonly DailySummaryMessage[] = [
  {
    headline: "Your Bizlee workspace is ready",
    summary: "Add your first lead to start seeing useful daily insights.",
  },
  {
    headline: "A great place to begin",
    summary: "Add a lead, quotation, or project and keep every next step clear.",
  },
  {
    headline: "Small steps build momentum",
    summary: "Start with one lead today and let Bizlee organise the work ahead.",
  },
  {
    headline: "Your first insight is one record away",
    summary: "Add a lead or quotation to unlock more useful daily updates.",
  },
  {
    headline: "Everything is set for a strong start",
    summary: "Record your first customer enquiry and turn it into a clear next step.",
  },
  {
    headline: "Ready when you are",
    summary: "Add your first business record and Bizlee will begin highlighting what matters.",
  },
  {
    headline: "Make today your starting point",
    summary: "Create a lead, quote, or project to bring your daily summary to life.",
  },
  {
    headline: "Aaj se shuru karein",
    summary: "Ek lead add kijiye aur Bizlee aapke next steps clear rakhega.",
  },
  {
    headline: "Chhoti shuruaat, badi progress",
    summary: "Aaj ek enquiry add kijiye aur apna sales flow aage badhaiye.",
  },
  {
    headline: "Bizlee aapke saath hai",
    summary: "Pehla lead, quote, ya project add karke aaj ka kaam organise kijiye.",
  },
  {
    headline: "Aaj ka ek step kaafi hai",
    summary: "Apna pehla customer record add kijiye aur momentum banaiye.",
  },
];

export function hasDailySummaryInsights(snapshot: DailySummarySnapshot) {
  return Object.values(snapshot).some((value) => value > 0);
}

export function isActiveTrial(subscription: TrialSubscription | null, now = new Date()) {
  if (subscription?.status !== "trialing" || !subscription.trial_ends_at) {
    return false;
  }

  const trialEnd = Date.parse(subscription.trial_ends_at);
  return Number.isFinite(trialEnd) && trialEnd > now.getTime();
}

export function chooseDailyTrialFallback(companyId: string, localDate: string) {
  const seed = `${companyId}:${localDate}`;
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return TRIAL_EMPTY_SUMMARY_MESSAGES[(hash >>> 0) % TRIAL_EMPTY_SUMMARY_MESSAGES.length];
}

export { TRIAL_EMPTY_SUMMARY_MESSAGES };
