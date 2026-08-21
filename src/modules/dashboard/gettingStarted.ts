import type { OrganizationSettings } from "../settings/types";
import { openCreateEnquiryState } from "../onboarding/onboardingReady.ts";

export const gettingStartedDestinations = {
  company: "/settings#company-profile",
  products: "/products-materials/products",
  team: "/settings#staff-management",
  enquiry: "/leads",
} as const;

export const openGettingStartedEnquiryState = openCreateEnquiryState;

export type GettingStartedTaskKey =
  | "company"
  | "products"
  | "team"
  | "enquiry";

export type GettingStartedTaskStatus = "complete" | "incomplete" | "unknown";

export type GettingStartedTask = {
  key: GettingStartedTaskKey;
  label: string;
  actionLabel: string;
  destination: (typeof gettingStartedDestinations)[GettingStartedTaskKey];
  status: GettingStartedTaskStatus;
};

export type GettingStartedState = {
  completedCount: number;
  hasUnknown: boolean;
  tasks: GettingStartedTask[];
};

type TeamActivationData = {
  additionalActiveOrInvitedCount: number;
};

type GettingStartedDependencies = {
  loadCompany: () => Promise<Pick<OrganizationSettings, "company_name">>;
  loadProducts: () => Promise<readonly unknown[]>;
  loadTeam: () => Promise<TeamActivationData>;
  loadEnquiries: () => Promise<readonly unknown[]>;
};

const taskDefinitions = [
  {
    key: "company",
    label: "Company profile",
    actionLabel: "Complete",
    destination: gettingStartedDestinations.company,
  },
  {
    key: "products",
    label: "Add products",
    actionLabel: "Add",
    destination: gettingStartedDestinations.products,
  },
  {
    key: "team",
    label: "Add team",
    actionLabel: "Add",
    destination: gettingStartedDestinations.team,
  },
  {
    key: "enquiry",
    label: "Create first enquiry",
    actionLabel: "Create",
    destination: gettingStartedDestinations.enquiry,
  },
] as const;

export async function loadGettingStartedState({
  loadCompany,
  loadProducts,
  loadTeam,
  loadEnquiries,
}: GettingStartedDependencies): Promise<GettingStartedState> {
  const [company, products, team, enquiries] = await Promise.allSettled([
    loadCompany(),
    loadProducts(),
    loadTeam(),
    loadEnquiries(),
  ]);

  const statuses: Record<GettingStartedTaskKey, GettingStartedTaskStatus> = {
    company:
      company.status === "fulfilled"
        ? statusFromCompletion(isCompanySetupComplete(company.value))
        : "unknown",
    products:
      products.status === "fulfilled"
        ? statusFromCompletion(products.value.length > 0)
        : "unknown",
    team:
      team.status === "fulfilled"
        ? teamStatus(team.value)
        : "unknown",
    enquiry:
      enquiries.status === "fulfilled"
        ? statusFromCompletion(enquiries.value.length > 0)
        : "unknown",
  };

  const tasks = taskDefinitions.map((task) => ({
    ...task,
    status: statuses[task.key],
  }));

  return {
    completedCount: tasks.filter((task) => task.status === "complete").length,
    hasUnknown: tasks.some((task) => task.status === "unknown"),
    tasks,
  };
}

export function isCompanySetupComplete(
  settings: Pick<OrganizationSettings, "company_name">,
) {
  // Company Setup currently requires only Company Name. GSTIN, contact details,
  // address, state, and branding remain optional there and must stay optional here.
  return Boolean(settings.company_name?.trim());
}

export function hasAdditionalActiveOrInvitedTeamMember({
  additionalActiveOrInvitedCount,
}: TeamActivationData) {
  return additionalActiveOrInvitedCount > 0;
}

export function shouldShowGettingStarted(state: GettingStartedState) {
  return state.tasks.some((task) => task.status !== "complete");
}

function teamStatus(data: TeamActivationData): GettingStartedTaskStatus {
  return statusFromCompletion(hasAdditionalActiveOrInvitedTeamMember(data));
}

function statusFromCompletion(complete: boolean): GettingStartedTaskStatus {
  return complete ? "complete" : "incomplete";
}
