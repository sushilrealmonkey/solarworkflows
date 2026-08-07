export function normalizeIndianPhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error("Enter a valid Indian mobile number");
  return `+91${digits}`;
}
