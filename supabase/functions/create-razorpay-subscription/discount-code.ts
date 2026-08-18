export function normalizedDiscountCode(value: string | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function discountCodeMatches(
  provided: string | undefined,
  configured: string | undefined,
) {
  const left = normalizedDiscountCode(provided);
  const right = normalizedDiscountCode(configured);
  if (!left || !right || left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
