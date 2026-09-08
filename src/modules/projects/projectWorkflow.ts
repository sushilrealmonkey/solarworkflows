import type { DiscomStatus, ProjectStatus } from "./types";

export type ProjectStatusTone =
  | "neutral"
  | "amber"
  | "blue"
  | "green"
  | "red";

export type ProjectStatusOption = {
  value: ProjectStatus;
  label: string;
  tone: ProjectStatusTone;
};

// These are the active stages shown in order everywhere a project is tracked.
// The persisted values are enforced by the project status constraint and used
// by the material dispatch and field-work workflows.
export const projectExecutionStatusOptions: ProjectStatusOption[] = [
  { value: "created", label: "Created", tone: "neutral" },
  {
    value: "material_dispatched",
    label: "Material Dispatched",
    tone: "amber",
  },
  {
    value: "installation_scheduled",
    label: "Installation Scheduled",
    tone: "blue",
  },
  {
    value: "installation_completed",
    label: "Installation Completed",
    tone: "blue",
  },
  {
    value: "inspection_completed",
    label: "Inspection Completed",
    tone: "green",
  },
  {
    value: "net_metering_pending",
    label: "Net Metering Pending",
    tone: "amber",
  },
  { value: "commissioned", label: "Commissioned", tone: "green" },
];

export const projectExceptionStatusOptions: ProjectStatusOption[] = [
  { value: "on_hold", label: "On Hold", tone: "amber" },
  { value: "cancelled", label: "Cancelled", tone: "red" },
];

export const projectStatusOptions = [
  ...projectExecutionStatusOptions,
  ...projectExceptionStatusOptions,
] as const;

export type DiscomStatusOption = {
  value: DiscomStatus;
  label: string;
  tone: ProjectStatusTone;
};

// These steps are deliberately DISCOM-agnostic so every company can track the
// same regulatory handoff without embedding a utility-specific workflow.
export const discomStatusOptions: DiscomStatusOption[] = [
  { value: "application_submitted", label: "Application Submitted", tone: "blue" },
  { value: "feasibility_approved", label: "Feasibility Approved", tone: "green" },
  { value: "inspection_scheduled", label: "Inspection Scheduled", tone: "amber" },
  { value: "inspection_completed", label: "Inspection Completed", tone: "blue" },
  { value: "net_meter_installed", label: "Net Meter Installed", tone: "green" },
  { value: "completed", label: "Completed", tone: "green" },
  { value: "on_hold", label: "On Hold", tone: "amber" },
  { value: "rejected", label: "Rejected", tone: "red" },
];

export function projectStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return projectStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function projectStatusTone(value: string | null | undefined) {
  return (
    projectStatusOptions.find((option) => option.value === value)?.tone ??
    "neutral"
  );
}

export function discomStatusLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return discomStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function discomStatusTone(value: string | null | undefined) {
  return (
    discomStatusOptions.find((option) => option.value === value)?.tone ??
    "neutral"
  );
}
