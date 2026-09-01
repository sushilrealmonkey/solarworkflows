import type { SubscriptionAccess } from "../billing/types";

type WorkspaceSubscription = Pick<
  SubscriptionAccess,
  "is_invitation_trial" | "status"
>;

export function hasWorkspacePaymentAccess(
  subscription: WorkspaceSubscription | null | undefined,
) {
  return (
    subscription?.status === "active" ||
    subscription?.status === "grandfathered" ||
    (subscription?.status === "trialing" && subscription.is_invitation_trial === true)
  );
}
