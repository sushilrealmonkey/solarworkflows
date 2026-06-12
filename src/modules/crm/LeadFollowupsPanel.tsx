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
  classifyFollowupDueDate,
  emptyFollowupForm,
  followupStatusOptions,
  followupToForm,
  followupTypeOptions,
  formatDateTime,
  getFollowupDueDate,
  labelize,
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
  EmptyState,
  Modal,
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

      if (formState.mode === "create") {
        const createdFollowup = await createLeadFollowup(
          profile,
          leadId,
          formState.values,
        );
        setFollowups((current) => [createdFollowup, ...current]);
        showToast("Follow-up added.", "success");
      } else if (formState.followup) {
        const updatedFollowup = await updateLeadFollowup(
          formState.followup.id,
          formState.values,
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
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
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
        <div className="mt-5 space-y-3">
          {followups.map((followup) => (
            <article
              key={followup.id}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="blue">{labelize(followup.followup_type)}</Badge>
                    <StatusBadge value={followup.status} />
                    <DueBadge followup={followup} />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-950">
                    {formatDateTime(followup.followup_date)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Next: {formatDateTime(followup.next_followup_date)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Assigned to {staffName(staff, followup.assigned_to)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canUpdate ? (
                    <>
                      <Button
                        onClick={() => openEditForm(followup)}
                        variant="secondary"
                      >
                        Edit
                      </Button>
                      {followup.status !== "completed" ? (
                        <Button
                          onClick={() => handleComplete(followup)}
                          disabled={completingId === followup.id}
                          variant="secondary"
                        >
                          {completingId === followup.id
                            ? "Completing..."
                            : "Mark Completed"}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              {followup.notes ? (
                <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                  {followup.notes}
                </p>
              ) : null}
            </article>
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
