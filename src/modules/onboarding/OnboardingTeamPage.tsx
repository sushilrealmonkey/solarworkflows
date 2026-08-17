import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import {
  createStaff,
  fetchSettingsRoles,
  fetchSettingsStaff,
} from "../settings/settingsApi";
import type { SettingsRole, SettingsStaff } from "../settings/types";
import { advanceCurrentCompanyOnboarding } from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";
import {
  appendTeamMemberDraft,
  createTeamMemberDraft,
  inviteTeamMemberDrafts,
  isTeamMemberDraftEmpty,
  removeTeamMemberDraft,
  runTeamSetupTransition,
  runTeamSubmissionLock,
  updateTeamMemberDraftValue,
  type TeamMemberDraft,
} from "./onboardingTeamSetup";

type PageAction = "invite" | "skip" | "back" | null;

export function OnboardingTeamPage() {
  const navigate = useNavigate();
  const { setProgress } = useOnboarding();
  const draftNumber = useRef(2);
  const submissionLock = useRef(false);
  const [rows, setRows] = useState<TeamMemberDraft[]>(() => [
    createTeamMemberDraft("onboarding-team-member-1"),
  ]);
  const [roles, setRoles] = useState<SettingsRole[]>([]);
  const [existingStaff, setExistingStaff] = useState<SettingsStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [action, setAction] = useState<PageAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadTeamOptions() {
      try {
        setLoading(true);
        setLoadError(null);
        const [nextRoles, nextStaff] = await Promise.all([
          fetchSettingsRoles(),
          fetchSettingsStaff(),
        ]);
        if (!active) return;
        setRoles(nextRoles);
        setExistingStaff(nextStaff);
      } catch (nextError) {
        if (active) {
          setLoadError(
            messageFor(nextError, "Team roles and members could not be loaded."),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTeamOptions();
    return () => {
      active = false;
    };
  }, [loadVersion]);

  function nextBlankRow() {
    const id = `onboarding-team-member-${draftNumber.current}`;
    draftNumber.current += 1;
    return createTeamMemberDraft(id);
  }

  function addRow() {
    if (action) return;
    setRows((current) => appendTeamMemberDraft(current, nextBlankRow()));
    clearMessages();
  }

  function removeRow(id: string) {
    if (action) return;
    setRows((current) =>
      removeTeamMemberDraft(current, id, nextBlankRow()),
    );
    clearMessages();
  }

  function updateRow(
    id: string,
    key: "full_name" | "email" | "role_id",
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? updateTeamMemberDraftValue(row, key, value) : row,
      ),
    );
    clearMessages();
  }

  function clearMessages() {
    setError(null);
    setSummary(null);
  }

  async function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runTeamSubmissionLock(submissionLock, async () => {
      try {
        setAction("invite");
        clearMessages();
        const result = await inviteTeamMemberDrafts(
          rows,
          roles,
          existingStaff,
          createStaff,
          setRows,
        );
        setRows(result.rows);

        if (result.validationBlocked) {
          setError("Check the highlighted team member fields before continuing.");
          return;
        }

        if (result.failedCount > 0) {
          const totalInvited = result.rows.filter(
            (row) => row.status === "invited",
          ).length;
          setError(
            `${result.failedCount} invitation${result.failedCount === 1 ? "" : "s"} could not be sent. Review the row errors and retry.`,
          );
          setSummary(
            `${totalInvited} team member${totalInvited === 1 ? "" : "s"} invited. Invited rows will not be sent again.`,
          );
          return;
        }

        if (result.allInvited) await exitWorkspace("complete");
      } catch (nextError) {
        setError(
          messageFor(nextError, "Team invitations could not be sent or continued."),
        );
      } finally {
        setAction(null);
      }
    });
  }

  async function exitWorkspace(nextAction: "complete" | "skip" | "back") {
    await runTeamSetupTransition(nextAction, {
      persist: advanceCurrentCompanyOnboarding,
      commit: setProgress,
      navigate: (route) => navigate(route, { replace: true }),
    });
  }

  async function leaveWorkspace(nextAction: "skip" | "back") {
    await runTeamSubmissionLock(submissionLock, async () => {
      try {
        setAction(nextAction);
        clearMessages();
        await exitWorkspace(nextAction);
      } catch (nextError) {
        setError(
          messageFor(nextError, "Onboarding progress could not be updated."),
        );
      } finally {
        setAction(null);
      }
    });
  }

  return (
    <OnboardingTeamView
      action={action}
      error={error}
      loadError={loadError}
      loading={loading}
      onAdd={addRow}
      onBack={() => void leaveWorkspace("back")}
      onRemove={removeRow}
      onRetryLoad={() => setLoadVersion((version) => version + 1)}
      onSkip={() => void leaveWorkspace("skip")}
      onSubmit={(event) => void submitTeam(event)}
      onUpdate={updateRow}
      roles={roles}
      rows={rows}
      summary={summary}
    />
  );
}

type OnboardingTeamViewProps = {
  action: PageAction;
  error: string | null;
  loadError: string | null;
  loading: boolean;
  onAdd: () => void;
  onBack: () => void;
  onRemove: (id: string) => void;
  onRetryLoad: () => void;
  onSkip: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (
    id: string,
    key: "full_name" | "email" | "role_id",
    value: string,
  ) => void;
  roles: SettingsRole[];
  rows: TeamMemberDraft[];
  summary: string | null;
};

export function OnboardingTeamView({
  action,
  error,
  loadError,
  loading,
  onAdd,
  onBack,
  onRemove,
  onRetryLoad,
  onSkip,
  onSubmit,
  onUpdate,
  roles,
  rows,
  summary,
}: OnboardingTeamViewProps) {
  const busy = action !== null;
  const failedRows = rows.filter((row) => row.status === "error").length;
  const intendedRows = rows.filter(
    (row) => row.status === "invited" || !isTeamMemberDraftEmpty(row),
  );
  const invitingIndex = intendedRows.findIndex(
    (row) => row.status === "inviting",
  );
  const supportingCopy =
    "Invite the people who help manage your leads, projects, operations and accounts.";

  return (
    <AuthThemeShell
      badge="Step 4 of 5"
      contentMaxWidthClass="max-w-none"
      desktopDescription={supportingCopy}
      mobileDescription={supportingCopy}
      title="Add your team"
      workspaceLayout
    >
      <AuthThemeCard>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm font-semibold text-orange-200">Step 4 of 5</p>
          <span className="text-xs font-medium text-slate-400">
            Team · Add members
          </span>
        </div>
        <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <span
              className={`h-1.5 flex-1 rounded-full ${index < 4 ? "bg-orange-400" : "bg-white/15"}`}
              key={index}
            />
          ))}
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold text-white">Team workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Add a few key people now. You can add or manage team members later from Settings.
          </p>
        </div>

        {loading ? (
          <TeamLoading />
        ) : loadError ? (
          <TeamLoadError message={loadError} onRetry={onRetryLoad} />
        ) : (
          <form className="mt-6" noValidate onSubmit={onSubmit}>
            {roles.length === 0 ? (
              <p
                className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100"
                role="alert"
              >
                No assignable Bizlee roles are available. Try loading the team setup again.
              </p>
            ) : null}

            <div className="hidden lg:block">
              <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.15fr)_minmax(9rem,0.75fr)_7rem_3rem] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
                <span>Status</span>
                <span className="sr-only">Action</span>
              </div>
              <div className="mt-2 space-y-3">
                {rows.map((row, index) => (
                  <DesktopTeamRow
                    disabled={busy}
                    index={index}
                    key={row.id}
                    onRemove={onRemove}
                    onUpdate={onUpdate}
                    roles={roles}
                    row={row}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4 lg:hidden">
              {rows.map((row, index) => (
                <MobileTeamCard
                  disabled={busy}
                  index={index}
                  key={row.id}
                  onRemove={onRemove}
                  onUpdate={onUpdate}
                  roles={roles}
                  row={row}
                />
              ))}
            </div>

            <button
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-orange-300/45 px-4 py-2.5 text-sm font-semibold text-orange-200 outline-none transition hover:border-orange-300 hover:bg-orange-300/10 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={busy}
              onClick={onAdd}
              type="button"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Add Another Team Member
            </button>

            <div aria-live="polite">
              {action === "invite" && invitingIndex >= 0 ? (
                <p className="mt-5 rounded-xl border border-orange-300/25 bg-orange-300/10 px-4 py-3 text-sm leading-6 text-orange-100" role="status">
                  Inviting {invitingIndex + 1} of {intendedRows.length} team members…
                </p>
              ) : null}
              {summary ? (
                <p className="mt-5 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm leading-6 text-emerald-100" role="status">
                  {summary}
                </p>
              ) : null}
            </div>
            {error ? (
              <p className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col-reverse gap-2 sm:flex-row [&>button]:min-h-11 [&>button]:w-full sm:[&>button]:w-auto [&>button]:!text-slate-200 [&>button:hover]:!bg-white/10">
                <Button disabled={busy} onClick={onBack} variant="ghost">
                  {action === "back" ? "Going back..." : "Back"}
                </Button>
                <Button disabled={busy} onClick={onSkip} variant="ghost">
                  {action === "skip" ? "Skipping..." : "Skip for Now"}
                </Button>
              </div>
              <div className="[&>button]:min-h-11 [&>button]:w-full sm:[&>button]:w-auto">
                <Button disabled={busy || roles.length === 0} type="submit">
                  {action === "invite" ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Sending invitations...
                    </span>
                  ) : failedRows > 0 ? "Retry Failed Invitations" : "Invite Team & Continue"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

type TeamRowProps = {
  disabled: boolean;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    key: "full_name" | "email" | "role_id",
    value: string,
  ) => void;
  roles: SettingsRole[];
  row: TeamMemberDraft;
};

function DesktopTeamRow(props: TeamRowProps) {
  const { disabled, index, onRemove, row } = props;
  const locked = disabled || row.status === "invited" || row.status === "inviting";

  return (
    <fieldset className="rounded-2xl border border-white/12 bg-white/[0.045] p-3">
      <legend className="sr-only">Team Member {index + 1}</legend>
      <div className="grid grid-cols-[minmax(10rem,1fr)_minmax(13rem,1.15fr)_minmax(9rem,0.75fr)_7rem_3rem] items-start gap-3">
        <TeamFields {...props} idSuffix="desktop" labels="hidden" />
        <TeamStatusBadge status={row.status} />
        <RowAction
          disabled={locked}
          index={index}
          invited={row.status === "invited"}
          onRemove={() => onRemove(row.id)}
        />
      </div>
      <TeamRowMessage row={row} />
    </fieldset>
  );
}

function MobileTeamCard(props: TeamRowProps) {
  const { disabled, index, onRemove, row } = props;
  const locked = disabled || row.status === "invited" || row.status === "inviting";

  return (
    <fieldset className="rounded-2xl border border-white/15 bg-white/[0.055] p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold text-white">Team Member {index + 1}</legend>
        <TeamStatusBadge status={row.status} />
      </div>
      <div className="mt-4 grid min-w-0 gap-4">
        <TeamFields {...props} idSuffix="mobile" labels="visible" />
      </div>
      <TeamRowMessage row={row} />
      {row.status !== "invited" ? (
        <button
          aria-label={`Remove team member ${index + 1}`}
          className="mt-4 min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50"
          disabled={locked}
          onClick={() => onRemove(row.id)}
          type="button"
        >
          Remove
        </button>
      ) : null}
    </fieldset>
  );
}

function TeamFields({
  disabled,
  idSuffix,
  labels,
  onUpdate,
  roles,
  row,
}: TeamRowProps & { idSuffix: string; labels: "visible" | "hidden" }) {
  const locked = disabled || row.status === "invited" || row.status === "inviting";

  return (
    <>
      <TeamInput
        disabled={locked}
        error={row.errors.full_name}
        id={`${row.id}-${idSuffix}-name`}
        label="Name"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "full_name", value)}
        placeholder="e.g. Rahul Sharma"
        value={row.values.full_name}
      />
      <TeamInput
        disabled={locked}
        error={row.errors.email}
        id={`${row.id}-${idSuffix}-email`}
        label="Email"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "email", value)}
        placeholder="rahul@example.com"
        type="email"
        value={row.values.email}
      />
      <TeamSelect
        disabled={locked}
        error={row.errors.role_id}
        id={`${row.id}-${idSuffix}-role`}
        label="Role"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "role_id", value)}
        options={[
          { value: "", label: "Select role" },
          ...roles.map((role) => ({ value: role.id, label: role.role_name })),
        ]}
        value={row.values.role_id}
      />
    </>
  );
}

function TeamInput({
  disabled,
  error,
  id,
  label,
  labelStyle,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  labelStyle: "visible" | "hidden";
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelStyle === "visible" ? "text-sm font-medium text-slate-200" : "sr-only"}>{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${teamControlClass} ${labelStyle === "visible" ? "mt-1.5" : ""} ${error ? "border-red-300/70" : ""}`}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error ? <span className="mt-1 block text-xs text-red-200" id={errorId}>{error}</span> : null}
    </label>
  );
}

function TeamSelect({
  disabled,
  error,
  id,
  label,
  labelStyle,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  labelStyle: "visible" | "hidden";
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelStyle === "visible" ? "text-sm font-medium text-slate-200" : "sr-only"}>{label}</span>
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${teamControlClass} ${labelStyle === "visible" ? "mt-1.5" : ""} ${error ? "border-red-300/70" : ""}`}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error ? <span className="mt-1 block text-xs text-red-200" id={errorId}>{error}</span> : null}
    </label>
  );
}

function TeamStatusBadge({ status }: { status: TeamMemberDraft["status"] }) {
  const label = status === "invited"
    ? "Invited"
    : status === "inviting"
      ? "Inviting"
      : status === "error"
        ? "Needs attention"
        : "Draft";
  const className = status === "invited"
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : status === "error"
      ? "border-red-300/25 bg-red-400/10 text-red-100"
      : status === "inviting"
        ? "border-orange-300/25 bg-orange-300/10 text-orange-100"
        : "border-white/15 bg-white/[0.06] text-slate-300";

  return (
    <span className={`inline-flex min-h-8 w-fit items-center justify-center rounded-full border px-2.5 text-xs font-semibold ${className}`} role="status">
      {label}
    </span>
  );
}

function RowAction({
  disabled,
  index,
  invited,
  onRemove,
}: {
  disabled: boolean;
  index: number;
  invited: boolean;
  onRemove: () => void;
}) {
  if (invited) return <span aria-hidden="true" />;
  return (
    <button
      aria-label={`Remove team member ${index + 1}`}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50"
      disabled={disabled}
      onClick={onRemove}
      title={`Remove team member ${index + 1}`}
      type="button"
    >
      <TrashIcon />
    </button>
  );
}

function TeamRowMessage({ row }: { row: TeamMemberDraft }) {
  if (row.error) {
    return <p className="mt-2 rounded-lg border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100" role="alert">{row.error}</p>;
  }
  if (row.status === "inviting") {
    return <p className="mt-2 text-xs text-orange-200" role="status">Sending this invitation...</p>;
  }
  if (row.status === "invited") {
    return <p className="mt-2 text-xs text-emerald-200" role="status">Invitation sent. This row is locked.</p>;
  }
  return null;
}

function TeamLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mt-6 space-y-3">
      <div className="h-4 w-48 animate-pulse rounded bg-white/15" />
      <div className="h-28 animate-pulse rounded-2xl bg-white/[0.08]" />
      <span className="sr-only">Loading team roles and existing members</span>
    </div>
  );
}

function TeamLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-red-300/20 bg-red-500/10 p-5">
      <h3 className="font-semibold text-white">Team setup unavailable</h3>
      <p className="mt-2 text-sm leading-6 text-red-100" role="alert">{message}</p>
      <div className="mt-4 [&>button]:w-full sm:[&>button]:w-auto">
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

const teamControlClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#132750] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-slate-400";

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
