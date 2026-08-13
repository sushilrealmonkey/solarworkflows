export type TrialCheckoutAction = "reuse" | "update" | "replace";

export function trialCheckoutAction(
  providerStatus: string | null,
  providerPlanId: string | null,
  targetPlanId: string,
): TrialCheckoutAction {
  const canUseExisting = ["created", "authenticated", "active"].includes(
    providerStatus ?? "",
  );

  if (canUseExisting && providerPlanId === targetPlanId) return "reuse";
  if (["authenticated", "active"].includes(providerStatus ?? "")) {
    return "update";
  }
  return "replace";
}
