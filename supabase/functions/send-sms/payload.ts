export type SendSmsHookPayload = {
  user?: {
    phone?: string | null;
    new_phone?: string | null;
  };
  sms?: {
    otp?: string | number | null;
    phone?: string | null;
  };
};

export type WhatsAppOtp = {
  mobile: string;
  otp: string;
};

export function parseWhatsAppOtp(
  payload: SendSmsHookPayload,
): WhatsAppOtp | null {
  const phone = firstNonBlank(
    payload.sms?.phone,
    payload.user?.new_phone,
    payload.user?.phone,
  );
  const mobile = normalizeIndianMobile(phone);
  const otp = String(payload.sms?.otp ?? "").trim();

  if (!mobile || !/^\d{6}$/.test(otp)) return null;

  return { mobile, otp };
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim()) ?? null;
}

function normalizeIndianMobile(phone: string | null) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return /^91[6-9]\d{9}$/.test(digits) ? digits : null;
}
