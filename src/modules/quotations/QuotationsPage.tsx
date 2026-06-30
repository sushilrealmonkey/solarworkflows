import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
  TextInput,
  Toolbar,
  ViewLink,
} from "../crm/CrmComponents";
import { formatDate, hasPermission, labelize } from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import {
  recordPaletteCardClassName,
  recordPaletteTableRowClassName,
} from "../shared/recordOriginStyles";
import { deleteQuotation, fetchQuotations } from "./quotationApi";
import {
  formatKw,
  formatMoney,
  getQuotationContact,
  quotationStatusOptions,
  quotationStatusTone,
} from "./quotationUtils";
import type { QuotationWithRelations } from "./types";

type QuotationFilters = {
  search: string;
  status: string;
  quotationDate: string;
  createdBy: string;
};

export function QuotationsPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [quotations, setQuotations] = useState<QuotationWithRelations[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<QuotationFilters>({
    search: "",
    status: "",
    quotationDate: "",
    createdBy: "",
  });
  const [deleteTarget, setDeleteTarget] =
    useState<QuotationWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [prefillHandled, setPrefillHandled] = useState(false);

  const canView = hasPermission(profile, permissions, "quotations", "view");
  const canCreate = hasPermission(profile, permissions, "quotations", "create");
  const canUpdate = hasPermission(profile, permissions, "quotations", "update");
  const canDelete = hasPermission(profile, permissions, "quotations", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateSurvey = hasPermission(
    profile,
    permissions,
    "site_surveys",
    "create",
  );

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextQuotations, nextStaff] = await Promise.all([
        fetchQuotations(profile),
        fetchStaffOptions(profile),
      ]);
      setQuotations(nextQuotations);
      setStaff(nextStaff);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load quotations.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  useEffect(() => {
    const shouldCreate = searchParams.get("new") === "1";
    if (!canCreate || !shouldCreate || prefillHandled) {
      return;
    }

    const nextParams = new URLSearchParams();
    const leadId = searchParams.get("leadId");
    const siteSurveyId = searchParams.get("siteSurveyId");
    if (!leadId && !siteSurveyId) {
      setPrefillHandled(true);
      setSearchParams({}, { replace: true });
      return;
    }
    if (leadId) {
      nextParams.set("leadId", leadId);
    }
    if (siteSurveyId) {
      nextParams.set("siteSurveyId", siteSurveyId);
    }
    setPrefillHandled(true);
    setSearchParams({}, { replace: true });
    navigate(`/quotations/new${nextParams.toString() ? `?${nextParams}` : ""}`, {
      replace: true,
    });
  }, [
    canCreate,
    navigate,
    prefillHandled,
    searchParams,
    setSearchParams,
  ]);

  const filteredQuotations = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return quotations.filter((quotation) => {
      const contact = getQuotationContact(quotation);
      const matchesSearch =
        !search ||
        [
          quotation.quotation_code,
          quotation.quotation_title,
          contact.customerName,
          quotation.lead?.full_name,
          contact.phone,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || quotation.status === filters.status;
      const matchesDate =
        !filters.quotationDate ||
        quotation.quotation_date === filters.quotationDate;
      const matchesCreator =
        !filters.createdBy || quotation.created_by === filters.createdBy;

      return matchesSearch && matchesStatus && matchesDate && matchesCreator;
    });
  }, [quotations, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="Quotations are not available"
        description="Your role needs quotations:view access to open this module."
      />
    );
  }

  function openEditForm(quotation: QuotationWithRelations) {
    navigate(`/quotations/${quotation.id}/edit`);
  }

  function openQuotationDetail(quotationId: string) {
    navigate(`/quotations/${quotationId}`);
  }

  function handleQuotationRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    quotationId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openQuotationDetail(quotationId);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await deleteQuotation(deleteTarget.id);
      setQuotations((current) =>
        current.filter((quotation) => quotation.id !== deleteTarget.id),
      );
      showToast("Quotation deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Quotations"
          description="Review itemized solar proposals created from enquiries and completed site survey data."
        />
      </div>

      <Toolbar className="md:grid-cols-3">
        <SearchInput
          className="md:col-span-3"
          placeholder="Search quote, customer, or phone"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...quotationStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <TextInput
          label="Quotation Date"
          type="date"
          value={filters.quotationDate}
          onChange={(quotationDate) =>
            setFilters((current) => ({ ...current, quotationDate }))
          }
        />
        <SelectInput
          label="Created By"
          value={filters.createdBy}
          onChange={(createdBy) =>
            setFilters((current) => ({ ...current, createdBy }))
          }
          options={[
            { value: "", label: "All creators" },
            ...staff.map((option) => ({
              value: option.id,
              label: option.full_name || option.email || option.phone || "Staff user",
            })),
          ]}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load quotations" description={error} /> : null}
      {!loading && !error && filteredQuotations.length === 0 ? (
        <EmptyState
          title="No quotations found"
          description="Quotations will appear here after they are created from an enquiry or site survey."
        />
      ) : null}

      {!loading && !error && filteredQuotations.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Quotation</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Net Payable</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Quote Date</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3 text-right">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredQuotations.map((quotation) => {
                  const contact = getQuotationContact(quotation);
                  return (
                    <tr
                      key={quotation.id}
                      className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName("projectFlow")}`}
                      onClick={() => openQuotationDetail(quotation.id)}
                      onKeyDown={(event) =>
                        handleQuotationRowKeyDown(event, quotation.id)
                      }
                      role="link"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {quotation.quotation_code ?? "-"}
                        {quotation.quotation_title ? (
                          <div className="mt-1 text-xs font-normal text-slate-500">
                          {quotation.quotation_title}
                        </div>
                      ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#06173f]">
                          {contact.customerName}
                        </div>
                        <div className="text-xs text-slate-500">{contact.phone}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {formatMoney(quotation.net_payable_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <QuotationStatusBadge value={quotation.status} />
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(quotation.quotation_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(quotation.valid_until)}
                      </td>
                      <td className="w-44 px-4 py-3">
                        <QuotationNextStepActions
                          canCreateSurvey={canCreateSurvey}
                          canViewProjects={canViewProjects}
                          quotation={quotation}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {filteredQuotations.map((quotation) => {
              const contact = getQuotationContact(quotation);
              return (
                <article
                  key={quotation.id}
                  className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName("projectFlow")}`}
                  onClick={() => openQuotationDetail(quotation.id)}
                  onKeyDown={(event) =>
                    handleQuotationRowKeyDown(event, quotation.id)
                  }
                  role="link"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {quotation.quotation_code ?? "Quotation"}
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-slate-950">
                        {contact.customerName}
                      </h2>
                      {quotation.quotation_title ? (
                        <p className="mt-1 text-sm text-slate-600">
                          {quotation.quotation_title}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-slate-600">
                        {contact.phone}
                      </p>
                    </div>
                    <QuotationStatusBadge value={quotation.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Capacity</dt>
                      <dd className="font-medium text-slate-900">
                        {formatKw(quotation.system_capacity_kw)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Net Payable</dt>
                      <dd className="font-semibold text-slate-950">
                        {formatMoney(quotation.net_payable_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Quote Date</dt>
                      <dd className="font-medium text-slate-900">
                        {formatDate(quotation.quotation_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Valid Until</dt>
                      <dd className="font-medium text-slate-900">
                        {formatDate(quotation.valid_until)}
                      </dd>
                    </div>
                  </dl>
                  <div
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <QuotationNextStepActions
                      canCreateSurvey={canCreateSurvey}
                      canViewProjects={canViewProjects}
                      quotation={quotation}
                    />
                  </div>
                  <div
                    className="mt-4 flex flex-wrap gap-2"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <ViewLink to={`/quotations/${quotation.id}`}>View</ViewLink>
                    {canUpdate ? (
                      <Button
                        onClick={() => openEditForm(quotation)}
                        variant="secondary"
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        onClick={() => setDeleteTarget(quotation)}
                        variant="danger"
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete quotation?"
          description={`This will remove ${deleteTarget.quotation_code ?? "this quotation"} and its line items.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function QuotationNextStepActions({
  quotation,
  canCreateSurvey,
  canViewProjects,
}: {
  quotation: QuotationWithRelations;
  canCreateSurvey: boolean;
  canViewProjects: boolean;
}) {
  const relatedSiteSurveyId =
    quotation.related_site_survey_id ?? quotation.site_survey_id;
  const projectPath = quotation.project_id
    ? `/projects/${quotation.project_id}`
    : "/projects";
  const className =
    "inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700";

  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {relatedSiteSurveyId && canViewProjects ? (
        <Link className={className} to={projectPath}>
          Go to Project
        </Link>
      ) : !relatedSiteSurveyId && canCreateSurvey && quotation.lead_id ? (
        <Link
          className={className}
          to={`/site-surveys?new=1&leadId=${quotation.lead_id}`}
        >
          Create Site Survey
        </Link>
      ) : (
        <span className="text-right text-sm font-medium text-slate-500">
          {relatedSiteSurveyId ? "Project ready" : "No next step available"}
        </span>
      )}
    </div>
  );
}

export function QuotationStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={quotationStatusTone(value)}>{labelize(value)}</Badge>;
}
