import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  createLeadFollowup,
  fetchLeadFollowups,
  markLeadFollowupCompleted,
  updateLeadFollowup,
} from "./crmApi";
import {
  bulletNoteText,
  classifyFollowupDueDate,
  emptyFollowupForm,
  followupStatusOptions,
  followupToForm,
  followupTypeOptions,
  formatDateTime,
  getFollowupDueDate,
  labelize,
  noteItems,
  requiredError,
  staffName,
} from "./crmUtils";
import type {
  LeadFollowup,
  LeadFollowupFormValues,
  StaffOption,
} from "./types";
import {
  Badge,
  Button,
  CheckIcon,
  EmptyState,
  Modal,
  PencilIcon,
  SelectInput,
  StaffSelect,
  StatusBadge,
  TextArea,
  TextInput,
} from "./CrmComponents";

export function LeadFollowupsPanel({
  leadId,
  defaultAssignedTo,
  staff,
  canCreate,
  canUpdate,
}: {
  leadId: string;
  defaultAssignedTo: string | null;
  staff: StaffOption[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [followups, setFollowups] = useState<LeadFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    followup: LeadFollowup | null;
    values: LeadFollowupFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  async function loadFollowups() {
    try {
      setLoading(true);
      setError(null);
      const nextFollowups = await fetchLeadFollowups(profile, leadId);
      setFollowups(nextFollowups);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load follow-ups.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFollowups();
    // loadFollowups closes over the current lead/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, profile?.id]);

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      followup: null,
      values: emptyFollowupForm(defaultAssignedTo ?? ""),
    });
  }

  function openEditForm(followup: LeadFollowup) {
    setFormErrors({});
    setFormState({
      mode: "edit",
      followup,
      values: followupToForm(followup),
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = {
      followup_date: requiredError(
        formState.values.followup_date,
        "Follow-up date",
      ),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      const normalizedValues = {
        ...formState.values,
        notes: bulletNoteText(formState.values.notes),
      };

      if (formState.mode === "create") {
        const createdFollowup = await createLeadFollowup(
          profile,
          leadId,
          normalizedValues,
        );
        setFollowups((current) => [createdFollowup, ...current]);
        showToast("Follow-up added.", "success");
      } else if (formState.followup) {
        const updatedFollowup = await updateLeadFollowup(
          formState.followup.id,
          normalizedValues,
        );
        setFollowups((current) =>
          current.map((followup) =>
            followup.id === updatedFollowup.id ? updatedFollowup : followup,
          ),
        );
        showToast("Follow-up updated.", "success");
      }

      setFormState(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Follow-up save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(followup: LeadFollowup) {
    try {
      setCompletingId(followup.id);
      const updatedFollowup = await markLeadFollowupCompleted(followup.id);
      setFollowups((current) =>
        current.map((item) =>
          item.id === updatedFollowup.id ? updatedFollowup : item,
        ),
      );
      showToast("Follow-up marked completed.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Could not complete follow-up.",
        "error",
      );
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Follow-up Timeline
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Track calls, messages, meetings, site visits, and next reminder dates.
          </p>
        </div>
        {canCreate ? <Button onClick={openCreateForm}>Add Follow-up</Button> : null}
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-lg border border-stone-100 bg-stone-50"
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5">
          <EmptyState title="Could not load follow-ups" description={error} />
        </div>
      ) : null}

      {!loading && !error && followups.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No follow-ups yet"
            description="Add the first follow-up when a call, message, meeting, or site visit is planned."
            action={canCreate ? <Button onClick={openCreateForm}>Add Follow-up</Button> : null}
          />
        </div>
      ) : null}

      {!loading && !error && followups.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 md:gap-4">
          {followups.map((followup) => (
            <FollowupCard
              key={followup.id}
              followup={followup}
              staff={staff}
              canUpdate={canUpdate}
              completing={completingId === followup.id}
              onComplete={() => void handleComplete(followup)}
              onEdit={() => openEditForm(followup)}
            />
          ))}
        </div>
      ) : null}

      {formState ? (
        <FollowupFormModal
          title={
            formState.mode === "create" ? "Add Follow-up" : "Edit Follow-up"
          }
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          staff={staff}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}
    </section>
  );
}

function FollowupCard({
  followup,
  staff,
  canUpdate,
  completing,
  onComplete,
  onEdit,
}: {
  followup: LeadFollowup;
  staff: StaffOption[];
  canUpdate: boolean;
  completing: boolean;
  onComplete: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="relative flex w-full min-h-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50 p-3 md:aspect-auto md:min-h-[14rem] md:flex-row md:gap-5 md:p-4">
      <div className="min-h-0 flex-1 pr-16 md:overflow-visible md:pr-24">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">{labelize(followup.followup_type)}</Badge>
          <StatusBadge value={followup.status} />
          <DueBadge followup={followup} />
        </div>
        <h3 className="mt-3 text-sm font-semibold leading-5 text-slate-950">
          {formatDateTime(followup.followup_date)}
        </h3>
        {followup.next_followup_date ? (
          <p className="mt-1 text-sm leading-5 text-slate-600">
            Next: {formatDateTime(followup.next_followup_date)}
          </p>
        ) : null}
        <p className="mt-1 text-sm leading-5 text-slate-600">
          Assigned to {staffName(staff, followup.assigned_to)}
        </p>

        {noteItems(followup.notes).length > 0 ? (
          <div className="mt-2 border-t border-stone-200 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </p>
            <BulletNoteList notes={followup.notes} />
          </div>
        ) : null}
      </div>

      {canUpdate ? (
        <div className="absolute right-4 top-4 flex gap-1.5 md:right-5 md:top-5">
          <button
            aria-label="Edit follow-up details"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm hover:bg-stone-100"
            onClick={onEdit}
            title="Edit follow-up details"
            type="button"
          >
            <PencilIcon />
          </button>
          {followup.status !== "completed" ? (
            <button
              aria-label="Mark follow-up completed"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={completing}
              onClick={onComplete}
              title="Mark follow-up completed"
              type="button"
            >
              <CheckIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function BulletNoteList({ notes }: { notes: string | null | undefined }) {
  const items = noteItems(notes);

  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="mt-1 max-h-8 list-disc space-y-0.5 overflow-hidden pl-4 text-[11px] leading-4 text-slate-700">
      {items.map((note, index) => <li className="line-clamp-1" key={index}>{note}</li>)}
    </ul>
  );
}

function DueBadge({ followup }: { followup: LeadFollowup }) {
  const state = classifyFollowupDueDate(followup);

  if (state === "overdue") {
    return <Badge tone="red">Overdue</Badge>;
  }

  if (state === "today") {
    return <Badge tone="amber">Due Today</Badge>;
  }

  if (state === "upcoming") {
    return <Badge tone="green">Upcoming</Badge>;
  }

  return <Badge>{formatDateTime(getFollowupDueDate(followup))}</Badge>;
}

function FollowupFormModal({
  title,
  values,
  setValues,
  errors,
  staff,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: LeadFollowupFormValues;
  setValues: (values: LeadFollowupFormValues) => void;
  errors: Record<string, string>;
  staff: StaffOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof LeadFollowupFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Follow-up"
      submitting={saving}
    >
      <SelectInput
        label="Follow-up Type"
        value={values.followup_type}
        onChange={(value) => update("followup_type", value)}
        options={followupTypeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) => update("status", value)}
        options={followupStatusOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Follow-up Date"
          value={values.followup_date}
          onChange={(value) => update("followup_date", value)}
          error={errors.followup_date}
          type="date"
          required
        />
        <TextInput
          label="Follow-up Time"
          value={values.followup_time}
          onChange={(value) => update("followup_time", value)}
          type="time"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Next Follow-up Date"
          value={values.next_followup_date}
          onChange={(value) => update("next_followup_date", value)}
          type="date"
        />
        <TextInput
          label="Next Follow-up Time"
          value={values.next_followup_time}
          onChange={(value) => update("next_followup_time", value)}
          type="time"
        />
      </div>
      <StaffSelect
        staff={staff}
        value={values.assigned_to}
        onChange={(value) => update("assigned_to", value)}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}
