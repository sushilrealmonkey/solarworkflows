export const MIN_TRIAL_EXTENSION_DAYS = 1;
export const MAX_TRIAL_EXTENSION_DAYS = 90;

export function parseTrialExtensionDays(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_TRIAL_EXTENSION_DAYS ||
    value > MAX_TRIAL_EXTENSION_DAYS
  ) {
    return null;
  }

  return value;
}

export function trialExtensionEndsAt(
  extensionDays: number,
  now = new Date(),
) {
  return new Date(
    now.getTime() + extensionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}
