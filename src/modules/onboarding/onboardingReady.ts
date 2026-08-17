import type { SettingsStaff } from "../settings/types";
import type { CompanyOnboardingProgress } from "./types";

export const readyScreenContent = {
  badge: "Step 5 of 5",
  context: "Ready to start",
  title: "Your Bizlee workspace is ready",
  description:
    "Your basic setup is complete. You can now start managing your solar business in Bizlee.",
} as const;

export const readyDestinations = {
  enquiry: "/leads?new=1",
  dashboard: "/dashboard",
  back: "/onboarding/team",
} as const;

export const openCreateEnquiryState = { openCreateEnquiry: true } as const;

export type ReadyAction = "enquiry" | "dashboard";

export type ReadySummary = {
  companyAvailable: boolean;
  productCount: number | null;
  team: TeamSummary | null;
};

export type TeamSummary = {
  activeCount: number;
  invitedCount: number;
  totalCount: number;
};

type ReadySummaryDependencies = {
  currentProfileId: string | null;
  loadCompany: () => Promise<unknown>;
  loadProducts: () => Promise<readonly unknown[]>;
  loadStaff: () => Promise<readonly SettingsStaff[]>;
};

type CompletionDependencies = {
  complete: () => Promise<CompanyOnboardingProgress>;
  finish: (
    progress: CompanyOnboardingProgress,
    route: string,
    options: { replace: true; state?: typeof openCreateEnquiryState },
  ) => void;
};

type BackDependencies = {
  persist: () => Promise<CompanyOnboardingProgress>;
  commit: (progress: CompanyOnboardingProgress) => void;
  navigate: (route: string, options: { replace: true }) => void;
};

export async function loadReadySummary({
  currentProfileId,
  loadCompany,
  loadProducts,
  loadStaff,
}: ReadySummaryDependencies): Promise<ReadySummary> {
  const [companyResult, productsResult, staffResult] = await Promise.allSettled([
    loadCompany(),
    loadProducts(),
    loadStaff(),
  ]);

  return {
    companyAvailable: companyResult.status === "fulfilled",
    productCount:
      productsResult.status === "fulfilled" ? productsResult.value.length : null,
    team:
      staffResult.status === "fulfilled"
        ? summarizeAdditionalTeam(staffResult.value, currentProfileId)
        : null,
  };
}

export function summarizeAdditionalTeam(
  staff: readonly Pick<SettingsStaff, "id" | "status">[],
  currentProfileId: string | null,
): TeamSummary {
  const additionalStaff = staff.filter((member) => member.id !== currentProfileId);
  const activeCount = additionalStaff.filter(
    (member) => member.status === "active",
  ).length;
  const invitedCount = additionalStaff.filter(
    (member) => member.status === "invited",
  ).length;

  return {
    activeCount,
    invitedCount,
    totalCount: activeCount + invitedCount,
  };
}

export function productSummaryCopy(count: number | null) {
  if (count === null) return "Product summary unavailable";
  if (count === 0) return "Products can be added anytime";
  return `${count} ${count === 1 ? "product" : "products"} added`;
}

export function teamSummaryCopy(team: TeamSummary | null) {
  if (!team) return "Team summary unavailable";
  if (team.totalCount === 0) return "Team members can be added anytime";
  if (team.activeCount > 0 && team.invitedCount > 0) {
    return `${team.totalCount} team members active or invited`;
  }
  if (team.invitedCount > 0) {
    return `${team.invitedCount} team ${team.invitedCount === 1 ? "member" : "members"} invited`;
  }
  return `${team.activeCount} team ${team.activeCount === 1 ? "member" : "members"} added`;
}

export function teamSummaryDetail(team: TeamSummary | null) {
  if (!team || team.activeCount === 0 || team.invitedCount === 0) return null;
  return `${team.activeCount} active · ${team.invitedCount} invited`;
}

export async function runReadyCompletion(
  action: ReadyAction,
  { complete, finish }: CompletionDependencies,
) {
  const progress = await complete();

  if (action === "enquiry") {
    finish(progress, readyDestinations.enquiry, {
      replace: true,
      state: openCreateEnquiryState,
    });
  } else {
    finish(progress, readyDestinations.dashboard, { replace: true });
  }

  return progress;
}

export async function runReadyBack({ persist, commit, navigate }: BackDependencies) {
  const progress = await persist();
  commit(progress);
  navigate(readyDestinations.back, { replace: true });
  return progress;
}

export async function runReadyActionLock(
  lock: { current: boolean },
  action: () => Promise<void>,
) {
  if (lock.current) return false;
  lock.current = true;

  try {
    await action();
    return true;
  } finally {
    lock.current = false;
  }
}
