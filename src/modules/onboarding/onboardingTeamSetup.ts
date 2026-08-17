import type { SettingsRole, SettingsStaff, StaffFormValues } from "../settings/types";
import type { CompanyOnboardingProgress, OnboardingStep } from "./types";

export type TeamMemberDraftStatus =
  | "draft"
  | "inviting"
  | "invited"
  | "error";

export type TeamMemberDraftErrors = {
  full_name?: string;
  email?: string;
  role_id?: string;
};

export type TeamMemberDraft = {
  id: string;
  values: StaffFormValues;
  errors: TeamMemberDraftErrors;
  status: TeamMemberDraftStatus;
  error: string | null;
  invitedStaffId: string | null;
};

export type TeamSetupExitAction = "complete" | "skip" | "back";

export function createTeamMemberDraft(id: string): TeamMemberDraft {
  return {
    id,
    values: {
      full_name: "",
      phone: "",
      email: "",
      role_id: "",
      status: "invited",
    },
    errors: {},
    status: "draft",
    error: null,
    invitedStaffId: null,
  };
}

export function appendTeamMemberDraft(
  rows: TeamMemberDraft[],
  nextRow: TeamMemberDraft,
) {
  return [...rows, nextRow];
}

export function removeTeamMemberDraft(
  rows: TeamMemberDraft[],
  id: string,
  blankReplacement: TeamMemberDraft,
) {
  const remaining = rows.filter((row) => row.id !== id);
  return remaining.length ? remaining : [blankReplacement];
}

export function updateTeamMemberDraftValue(
  row: TeamMemberDraft,
  key: "full_name" | "email" | "role_id",
  value: string,
): TeamMemberDraft {
  if (row.status === "invited" || row.status === "inviting") return row;

  return {
    ...row,
    values: { ...row.values, [key]: value },
    errors: { ...row.errors, [key]: undefined },
    status: "draft",
    error: null,
  };
}

export function normalizeInvitationEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isTeamMemberDraftEmpty(row: TeamMemberDraft) {
  return [row.values.full_name, row.values.email, row.values.role_id].every(
    (value) => !value.trim(),
  );
}

export function validateTeamMemberDrafts(
  rows: TeamMemberDraft[],
  roles: SettingsRole[],
  existingStaff: SettingsStaff[],
) {
  const allowedRoleIds = new Set(roles.map((role) => role.id));
  const emailCounts = new Map<string, number>();

  for (const row of rows) {
    if (isTeamMemberDraftEmpty(row)) continue;
    const email = normalizeInvitationEmail(row.values.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }

  const existingByEmail = new Map(
    existingStaff
      .filter((member) => member.email)
      .map((member) => [normalizeInvitationEmail(member.email ?? ""), member]),
  );

  return rows.map((row) => {
    if (row.status === "invited") return row;
    if (isTeamMemberDraftEmpty(row)) {
      return { ...row, errors: {}, status: "draft" as const, error: null };
    }

    const fullName = row.values.full_name.trim();
    const email = normalizeInvitationEmail(row.values.email);
    const roleId = row.values.role_id.trim();
    const errors: TeamMemberDraftErrors = {};

    if (!fullName) errors.full_name = "Enter the team member's name.";
    if (!email) {
      errors.email = "Email is required to send the invitation.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    } else if ((emailCounts.get(email) ?? 0) > 1) {
      errors.email = "This person is already in your invite list.";
    } else {
      const existingMember = existingByEmail.get(email);
      if (existingMember?.status === "invited") {
        errors.email = "This person already has a pending invitation.";
      } else if (existingMember) {
        errors.email = "This team member is already part of your company.";
      }
    }

    if (!roleId) {
      errors.role_id = "Select a role.";
    } else if (!allowedRoleIds.has(roleId)) {
      errors.role_id = "Select an available Bizlee role.";
    }

    return {
      ...row,
      values: {
        ...row.values,
        full_name: fullName,
        email,
        role_id: roleId,
      },
      errors,
      status: "draft" as const,
      error: null,
    };
  });
}

export type InviteTeamMembersResult = {
  rows: TeamMemberDraft[];
  attemptedCount: number;
  invitedCount: number;
  failedCount: number;
  validationBlocked: boolean;
  allInvited: boolean;
};

export async function inviteTeamMemberDrafts(
  rows: TeamMemberDraft[],
  roles: SettingsRole[],
  existingStaff: SettingsStaff[],
  inviteMember: (values: StaffFormValues) => Promise<Partial<SettingsStaff>>,
  onRowsChange?: (rows: TeamMemberDraft[]) => void,
): Promise<InviteTeamMembersResult> {
  let nextRows = validateTeamMemberDrafts(rows, roles, existingStaff);
  const validationBlocked = nextRows.some(
    (row) =>
      row.status !== "invited" &&
      !isTeamMemberDraftEmpty(row) &&
      Object.values(row.errors).some(Boolean),
  );

  if (validationBlocked) {
    onRowsChange?.(nextRows);
    return resultForRows(nextRows, 0, 0, 0, true);
  }

  let attemptedCount = 0;
  let invitedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < nextRows.length; index += 1) {
    const row = nextRows[index];
    if (row.status === "invited" || isTeamMemberDraftEmpty(row)) continue;

    attemptedCount += 1;
    nextRows = replaceRow(nextRows, index, {
      ...row,
      status: "inviting",
      error: null,
    });
    onRowsChange?.(nextRows);

    try {
      const invited = await inviteMember(nextRows[index].values);
      invitedCount += 1;
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        status: "invited",
        error: null,
        invitedStaffId: invited.id ?? null,
      });
    } catch (error) {
      failedCount += 1;
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        status: "error",
        error: friendlyTeamInviteError(error),
      });
    }

    onRowsChange?.(nextRows);
  }

  return resultForRows(
    nextRows,
    attemptedCount,
    invitedCount,
    failedCount,
    false,
  );
}

export function friendlyTeamInviteError(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("core includes") && normalized.includes("total users")) {
    return message;
  }
  if (normalized.includes("already exists") || normalized.includes("already been registered")) {
    return "This email is already a company member or has a pending invitation.";
  }
  if (normalized.includes("settings:update") || normalized.includes("permission")) {
    return "You do not have permission to invite this team member.";
  }
  if (normalized.includes("role") && (normalized.includes("standard") || normalized.includes("found"))) {
    return "The selected role is no longer available. Choose another role.";
  }
  if (normalized.includes("valid staff email") || normalized.includes("email is required")) {
    return "Enter a valid email address.";
  }

  return "We couldn't send this invitation. Please try again.";
}

export async function runTeamSubmissionLock<T>(
  lock: { current: boolean },
  task: () => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> {
  if (lock.current) return { started: false };
  lock.current = true;
  try {
    return { started: true, value: await task() };
  } finally {
    lock.current = false;
  }
}

export function transitionForTeamSetupAction(
  action: TeamSetupExitAction,
): { nextStep: OnboardingStep; route: string } {
  if (action === "back") {
    return { nextStep: "products", route: "/onboarding/products" };
  }

  return { nextStep: "ready", route: "/onboarding/ready" };
}

export async function runTeamSetupTransition(
  action: TeamSetupExitAction,
  {
    persist,
    commit,
    navigate,
  }: {
    persist: (step: OnboardingStep) => Promise<CompanyOnboardingProgress>;
    commit: (progress: CompanyOnboardingProgress) => void;
    navigate: (route: string) => void;
  },
) {
  const transition = transitionForTeamSetupAction(action);
  const progress = await persist(transition.nextStep);
  commit(progress);
  navigate(transition.route);
  return progress;
}

function replaceRow(
  rows: TeamMemberDraft[],
  index: number,
  row: TeamMemberDraft,
) {
  return rows.map((current, currentIndex) =>
    currentIndex === index ? row : current,
  );
}

function resultForRows(
  rows: TeamMemberDraft[],
  attemptedCount: number,
  invitedCount: number,
  failedCount: number,
  validationBlocked: boolean,
): InviteTeamMembersResult {
  return {
    rows,
    attemptedCount,
    invitedCount,
    failedCount,
    validationBlocked,
    allInvited: rows.every(
      (row) => row.status === "invited" || isTeamMemberDraftEmpty(row),
    ),
  };
}
