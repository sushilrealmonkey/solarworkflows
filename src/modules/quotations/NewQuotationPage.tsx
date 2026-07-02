import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import { formatDisplayDate } from "../../utils/dateFormat";
import {
  AccessDenied,
  AlertDialog,
  Button,
  EmptyState,
  LoadingSkeleton,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { hasPermission, labelize, requiredError } from "../crm/crmUtils";
import {
  customerOptionLabel,
  leadOptionLabel,
} from "../site-surveys/surveyUtils";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "../site-surveys/types";
import {
  createQuotation,
  fetchQuotation,
  fetchQuotationItems,
  fetchNextQuotationCode,
  fetchQuotationCustomers,
  fetchQuotationLead,
  fetchQuotationLeads,
  fetchQuotationSiteSurvey,
  fetchQuotationSiteSurveys,
  updateQuotation,
} from "./quotationApi";
import {
  fetchProductCategories,
  fetchProducts,
} from "../product-master/productMasterApi";
import type { Product, ProductCategory } from "../product-master/types";
import { fetchInventoryItems } from "../inventory/inventoryApi";
import {
  inventoryBrandName,
  inventoryModelName,
  inventoryProductName,
} from "../inventory/inventoryUtils";
import type { InventoryItem } from "../inventory/types";
import { fetchOrganizationSettings } from "../settings/settingsApi";
import {
  applySurveyToQuotationForm,
  amountInWordsFromTurnkeyCost,
  buildQuotationTitle,
  calculateDiscountedTurnkeyTotals,
  calculateExpectedAnnualGenerationInput,
  calculateTurnkeyGstBreakdown,
  defaultTechnicalPaymentTerms,
  deriveQuotationMaterialSummary,
  discountedTurnkeyAmount,
  emptyQuotationForm,
  formatMoneyWithPaise,
  hasTurnkeyGstAmount,
  leadToQuotationForm,
  normalizeQuotationCustomerType,
  quotationCustomerTypeOptions,
  quotationInverterTypeOptions,
  quotationModuleCategoryOptions,
  quotationPanelTechnologyOptions,
  quotationSiteTypeOptions,
  quotationSystemTypeOptions,
  quotationUnitOptions,
  quotationValidUntilFromDateInput,
  quotationToForm,
  surveyToQuotationForm,
} from "./quotationUtils";
import type {
  QuotationFormValues,
  QuotationMaterialItem,
  QuotationPaymentTermFormValues,
  QuotationWarrantyFormValues,
} from "./types";
import { generateAndStoreQuotationPdf } from "./quotationPdfWorkflow";

const tabs = [
  "Project",
  "BOM",
  "Commercial",
  "Warranty & Payment",
  "Review",
];

const createPanelWattageValue = "__create_panel_wattage__";
const standardPanelWattages = [
  "335",
  "400",
  "440",
  "450",
  "500",
  "520",
  "525",
  "540",
  "545",
  "550",
  "570",
  "580",
  "600",
  "620",
  "650",
];

export function NewQuotationPage() {
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { id: editQuotationId } = useParams();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [values, setValues] = useState<QuotationFormValues>(() =>
    newQuotationDefaults(emptyQuotationForm()),
  );
  const [bomDraft, setBomDraft] = useState<QuotationMaterialItem>(() =>
    emptyMaterialItem(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<SurveyCustomerSummary[]>([]);
  const [leads, setLeads] = useState<SurveyLeadSummary[]>([]);
  const [siteSurveys, setSiteSurveys] = useState<SiteSurveyWithRelations[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [creatingPanelWattage, setCreatingPanelWattage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showBomRequiredAlert, setShowBomRequiredAlert] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isEditing = Boolean(editQuotationId);
  const canView = hasPermission(profile, permissions, "quotations", "view");
  const canCreate = hasPermission(profile, permissions, "quotations", "create");
  const canUpdate = hasPermission(profile, permissions, "quotations", "update");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canSave = isEditing ? canUpdate : canCreate;
  const hasLinkedCreateSource = Boolean(
    searchParams.get("leadId") || searchParams.get("siteSurveyId"),
  );

  useEffect(() => {
    async function loadOptions() {
      if (!canView) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setLoadError(null);
        const [
          nextCustomers,
          nextLeads,
          nextSiteSurveys,
          nextProductCategories,
          nextProducts,
          nextInventoryItems,
          nextSettings,
          currentQuotation,
        ] = await Promise.all([
          fetchQuotationCustomers(profile),
          fetchQuotationLeads(profile),
          fetchQuotationSiteSurveys(profile),
          fetchProductCategories(profile),
          fetchProducts(profile),
          fetchInventoryItems(profile),
          fetchOrganizationSettings().catch(() => null),
          editQuotationId ? fetchQuotation(profile, editQuotationId) : null,
        ]);
        setCustomers(nextCustomers);
        setLeads(nextLeads);
        setSiteSurveys(nextSiteSurveys);
        setProductCategories(
          nextProductCategories.filter((category) => category.is_active !== false),
        );
        setProducts(nextProducts.filter((product) => product.status === "active"));
        setInventoryItems(
          nextInventoryItems.filter((item) => item.status === "active"),
        );
        if (editQuotationId) {
          if (!currentQuotation) {
            setLoadError("Quotation could not be found.");
            return;
          }

          setValues(newQuotationDefaults(quotationToForm(currentQuotation)));
          return;
        }

        const nextQuotationCode = await fetchNextQuotationCode(
          profile,
          nextSettings?.quotation_prefix,
        );
        setValues((current) =>
          current.quotation_code
            ? current
            : { ...current, quotation_code: nextQuotationCode },
        );
      } catch (nextError) {
        setLoadError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load quotation options.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadOptions();
  }, [canView, editQuotationId, profile]);

  useEffect(() => {
    async function applyPrefill() {
      if (isEditing) {
        return;
      }

      const siteSurveyId = searchParams.get("siteSurveyId");
      const leadId = searchParams.get("leadId");

      try {
        if (siteSurveyId) {
          const survey = await fetchQuotationSiteSurvey(profile, siteSurveyId);
          if (survey) {
            const surveyValues = surveyToQuotationForm(survey);
            setValues((current) =>
              newQuotationDefaults({
                ...surveyValues,
                quotation_code:
                  current.quotation_code || surveyValues.quotation_code,
              }),
            );
          }
          return;
        }

        if (leadId) {
          const lead = await fetchQuotationLead(profile, leadId);
          if (lead) {
            const leadValues = leadToQuotationForm(lead);
            setValues((current) =>
              newQuotationDefaults({
                ...leadValues,
                quotation_code: current.quotation_code || leadValues.quotation_code,
              }),
            );
          }
        }
      } catch (nextError) {
        showToast(
          nextError instanceof Error
            ? nextError.message
            : "Quotation prefill failed.",
          "error",
        );
      }
    }

    void applyPrefill();
  }, [isEditing, profile, searchParams, showToast]);

  const customerLabel = useMemo(
    () => customerName(values.customer_id, customers) || leadName(values.lead_id, leads),
    [customers, leads, values.customer_id, values.lead_id],
  );
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === values.lead_id) ?? null,
    [leads, values.lead_id],
  );
  const savedBomItems = useMemo(
    () => values.material_items.filter(hasSavedBomItem),
    [values.material_items],
  );
  const panelInventoryItems = useMemo(
    () => inventoryItems.filter((item) => item.item_category === "solar_panel"),
    [inventoryItems],
  );
  const inverterInventoryItems = useMemo(
    () => inventoryItems.filter((item) => item.item_category === "inverter"),
    [inventoryItems],
  );
  const panelBrandOptions = useMemo(
    () => inventoryBrandOptions(panelInventoryItems, "Select panel brand"),
    [panelInventoryItems],
  );
  const inverterBrandOptions = useMemo(
    () => inventoryBrandOptions(inverterInventoryItems, "Select inverter brand"),
    [inverterInventoryItems],
  );
  const panelWattageOptions = useMemo(
    () => panelWattageSelectOptions(panelInventoryItems),
    [panelInventoryItems],
  );
  const selectedPanelWattageValue =
    values.summary_module_wattage &&
    !panelWattageOptions.some(
      (option) => option.value === values.summary_module_wattage,
    )
      ? createPanelWattageValue
      : values.summary_module_wattage;
  const commercialTurnkeyAmount =
    values.summary_total_turnkey_cost || values.pricing_total_rate;
  const commercialDiscountedAmount = discountedTurnkeyAmount(
    commercialTurnkeyAmount,
    values.discount_amount,
  );

  if (!canView || !canSave) {
    return (
      <AccessDenied
        title={isEditing ? "Edit quotation is not available" : "New quotation is not available"}
        description={
          isEditing
            ? "Your role needs quotations:view and quotations:update access to edit a quotation."
            : "Your role needs quotations:view and quotations:create access to create a quotation."
        }
      />
    );
  }

  if (!isEditing && !hasLinkedCreateSource) {
    return (
      <AccessDenied
        title="New quotation starts from an enquiry"
        description="Open an enquiry or site survey and use Create Quotation to continue the workflow."
      />
    );
  }

  function update(key: keyof QuotationFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateQuotationDate(quotationDate: string) {
    setValues((current) => ({
      ...current,
      quotation_date: quotationDate,
      valid_until: quotationValidUntilFromDateInput(quotationDate),
    }));
  }

  function updateTurnkeyCost(totalTurnkeyCost: string) {
    setValues((current) => {
      const payableTurnkeyAmount = discountedTurnkeyAmount(
        totalTurnkeyCost,
        current.discount_amount,
      );

      return {
        ...current,
        summary_total_turnkey_cost: totalTurnkeyCost,
        pricing_total_rate: totalTurnkeyCost,
        summary_amount_in_words:
          payableTurnkeyAmount === null
            ? ""
            : amountInWordsFromTurnkeyCost(payableTurnkeyAmount),
        payment_term_rows: autoCalculatePaymentTermRows(
          current.payment_term_rows,
          payableTurnkeyAmount ?? totalTurnkeyCost,
        ),
      };
    });
  }

  function updateDiscountAmount(discountAmount: string) {
    setValues((current) => {
      const totalTurnkeyCost =
        current.summary_total_turnkey_cost || current.pricing_total_rate;
      const payableTurnkeyAmount = discountedTurnkeyAmount(
        totalTurnkeyCost,
        discountAmount,
      );

      return {
        ...current,
        discount_amount: discountAmount,
        summary_amount_in_words:
          payableTurnkeyAmount === null
            ? ""
            : amountInWordsFromTurnkeyCost(payableTurnkeyAmount),
        payment_term_rows: autoCalculatePaymentTermRows(
          current.payment_term_rows,
          payableTurnkeyAmount ?? totalTurnkeyCost,
        ),
      };
    });
  }

  function updateCapacity(capacity: string) {
    const expectedGeneration = calculateExpectedAnnualGenerationInput(capacity);

    setValues((current) => ({
      ...current,
      system_capacity_kw: capacity,
      expected_annual_generation_kwh: expectedGeneration,
      estimated_generation_units: expectedGeneration,
      summary_plant_size_kw: current.summary_plant_size_kw || capacity,
      quotation_title: buildQuotationTitle(
        capacity,
        current.module_category,
        current.customer_type,
      ),
    }));
  }

  function updateModuleCategory(moduleCategory: string) {
    setValues((current) => ({
      ...current,
      module_category: moduleCategory,
      quotation_title: buildQuotationTitle(
        current.system_capacity_kw,
        moduleCategory,
        current.customer_type,
      ),
    }));
  }

  function updateCustomerType(customerType: string) {
    setValues((current) => ({
      ...current,
      customer_type: customerType,
      quotation_title: buildQuotationTitle(
        current.system_capacity_kw,
        current.module_category,
        customerType,
      ),
    }));
  }

  function updatePanelWattage(wattage: string) {
    if (wattage === createPanelWattageValue) {
      setCreatingPanelWattage(true);
      return;
    }

    setCreatingPanelWattage(false);
    update("summary_module_wattage", wattage);
  }

  function updateLead(leadId: string) {
    const lead = leads.find((option) => option.id === leadId);
    if (!lead) {
      setValues((current) => ({ ...current, lead_id: leadId }));
      return;
    }

    setValues((current) =>
      applyLeadToCurrentQuotation(current, lead, customers),
    );
  }

  function updateSiteSurvey(siteSurveyId: string) {
    const survey = siteSurveys.find((option) => option.id === siteSurveyId);
    if (!survey) {
      setValues((current) => ({ ...current, site_survey_id: siteSurveyId }));
      return;
    }

    setValues((current) =>
      newQuotationDefaults(applySurveyToQuotationForm(current, survey)),
    );
  }

  function updateBomDraftCategory(categoryId: string) {
    setBomDraft((current) => ({
      ...current,
      product_category_id: categoryId,
      product_id: "",
      inventory_item_id: "",
      hsn_code: "",
      description: "",
      brand: "",
      specification: "",
      make_specification: "",
    }));
  }

  function updateBomDraftProduct(productId: string) {
    setBomDraft((current) => materialItemWithProduct(current, productId, products));
  }

  function updateBomDraft(key: keyof QuotationMaterialItem, value: string) {
    setBomDraft((current) => ({ ...current, [key]: value }));
  }

  function addBomDraft() {
    if (!bomDraft.product_category_id) {
      showToast("Select a BOM category.", "error");
      return;
    }

    if (!bomDraft.product_id) {
      showToast("Select a BOM product.", "error");
      return;
    }

    setValues((current) => ({
      ...current,
      material_items: [...current.material_items.filter(hasSavedBomItem), bomDraft],
    }));
    setBomDraft(emptyMaterialItem());
  }

  function removeBomItem(index: number) {
    setValues((current) => ({
      ...current,
      material_items: current.material_items
        .filter(hasSavedBomItem)
        .filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateWarranty(
    index: number,
    key: keyof QuotationWarrantyFormValues,
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      warranty_rows: current.warranty_rows.map((warranty, warrantyIndex) =>
        warrantyIndex === index ? { ...warranty, [key]: value } : warranty,
      ),
    }));
  }

  function updatePaymentTerm(
    index: number,
    key: keyof QuotationPaymentTermFormValues,
    value: string,
  ) {
    setValues((current) => {
      const paymentBaseAmount = quotationPaymentTermBaseAmount(current);

      return {
        ...current,
        payment_term_rows: current.payment_term_rows.map((paymentTerm, paymentIndex) =>
          paymentIndex === index
            ? autoCalculatePaymentTerm(
                { ...paymentTerm, [key]: value },
                paymentBaseAmount,
              )
            : paymentTerm,
        ),
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = {
      lead_id: requiredError(
        values.lead_id || values.customer_id || values.site_survey_id,
        "Lead",
      ),
      quotation_date: requiredError(values.quotation_date, "Quotation date"),
      system_capacity_kw: requiredError(values.system_capacity_kw, "System capacity"),
    };
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setActiveTab("Project");
      return;
    }

    if (savedBomItems.length === 0) {
      setActiveTab("BOM");
      setShowBomRequiredAlert(true);
      return;
    }

    try {
      setSaving(true);
      const quotation = editQuotationId
        ? await updateQuotation(
            profile,
            editQuotationId,
            prepareNewQuotationValues(values),
          )
        : await createQuotation(profile, prepareNewQuotationValues(values));

      let pdfGenerated = false;
      try {
        if (canCreateDocuments) {
          const fullQuotation = await fetchQuotation(profile, quotation.id);
          const quotationItems = await fetchQuotationItems(profile, quotation.id);

          if (fullQuotation) {
            await generateAndStoreQuotationPdf(
              profile,
              organization,
              fullQuotation,
              quotationItems,
            );
            pdfGenerated = true;
          }
        } else {
          showToast(
            "Quotation saved, but your role needs documents:create access to generate its PDF automatically.",
            "error",
          );
        }
      } catch (pdfError) {
        showToast(
          pdfError instanceof Error
            ? `Quotation saved, but PDF generation failed: ${pdfError.message}`
            : "Quotation saved, but PDF generation failed.",
          "error",
        );
      }

      showToast(
        pdfGenerated
          ? editQuotationId
            ? "Quotation updated and PDF refreshed."
            : "Quotation created and PDF generated."
          : editQuotationId
            ? "Quotation updated."
            : "Quotation created.",
        "success",
      );
      navigate(`/quotations/${quotation.id}`);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Quotation save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <Link
        className="text-sm font-semibold text-[#06173f]"
        to={editQuotationId ? `/quotations/${editQuotationId}` : "/quotations"}
      >
        Back to quotations
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title={isEditing ? "Edit Quotation" : "Create Quotation"}
          description="Build a technical and commercial proposal in guided steps."
        />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              navigate(editQuotationId ? `/quotations/${editQuotationId}` : "/quotations")
            }
            variant="secondary"
          >
            Cancel
          </Button>
          <Button disabled={saving} type="submit">
            {saving ? "Saving..." : isEditing ? "Update Quotation" : "Save Quotation"}
          </Button>
        </div>
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {loadError ? (
        <EmptyState title="Could not load quotation options" description={loadError} />
      ) : null}

      <div className="overflow-x-auto border-b border-stone-200 pb-2">
        <div className="flex min-w-max gap-2">
          {tabs.map((tab, index) => (
            <button
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab
                  ? "bg-orange-600 text-white"
                  : "bg-stone-100 text-slate-700 hover:bg-stone-200"
              }`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {index + 1}. {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Project" ? (
        <Section title="Project And Customer">
          <TextInput
            label="Quotation Number"
            value={values.quotation_code}
            onChange={(value) => update("quotation_code", value)}
          />
          <TextInput
            label="Quotation Date"
            value={values.quotation_date}
            onChange={updateQuotationDate}
            error={errors.quotation_date}
            required
            type="date"
          />
          <ReadOnlyField
            label="Valid Until"
            value={formatDisplayDate(values.valid_until)}
          />
          <ReadOnlyField
            label="Quotation Title"
            value={values.quotation_title || "-"}
          />
          <SelectInput
            label="Lead"
            value={values.lead_id}
            onChange={updateLead}
            options={[
              { value: "", label: "Select lead" },
              ...leads.map((lead) => ({
                value: lead.id,
                label: leadOptionLabel(lead),
              })),
            ]}
          />
          {selectedLead?.offered_price !== null &&
          selectedLead?.offered_price !== undefined ? (
            <ReadOnlyField
              label="Offered Price"
              value={formatMoneyWithPaise(selectedLead.offered_price)}
            />
          ) : null}
          {errors.lead_id ? (
            <p className="-mt-2 text-xs text-rose-700 md:col-span-2">
              {errors.lead_id}
            </p>
          ) : null}
          <SelectInput
            label="Site Survey"
            value={values.site_survey_id}
            onChange={updateSiteSurvey}
            options={[
              { value: "", label: "No site survey linked" },
              ...siteSurveys.map((survey) => ({
                value: survey.id,
                label: `${survey.survey_code ?? "Survey"} - ${
                  survey.customer?.full_name ?? survey.lead?.full_name ?? "Unlinked"
                }`,
              })),
            ]}
          />
          <SelectInput
            label="Customer Type"
            value={values.customer_type}
            onChange={updateCustomerType}
            options={[
              { value: "", label: "Select customer type" },
              ...quotationCustomerTypeOptions.map((value) => ({
                value,
                label: labelize(value),
              })),
            ]}
          />
          <TextArea
            label="Location / Address"
            value={values.installation_location}
            onChange={(value) => update("installation_location", value)}
            className="block"
          />
          <TextInput
            label="City / Village"
            value={values.customer_city_village}
            onChange={(value) => update("customer_city_village", value)}
          />
          <TextInput
            label="DISCOM"
            value={values.discom}
            onChange={(value) => update("discom", value)}
          />
          <TextInput
            label="System Capacity (kW)"
            value={values.system_capacity_kw}
            onChange={updateCapacity}
            error={errors.system_capacity_kw}
            required
            type="number"
          />
          <SelectInput
            label="System Type"
            value={values.system_type}
            onChange={(value) => update("system_type", value)}
            options={[
              { value: "", label: "Select system type" },
              ...quotationSystemTypeOptions.map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
          <SelectInput
            label="Panel Category"
            value={values.module_category}
            onChange={updateModuleCategory}
            options={[
              { value: "", label: "Select panel category" },
              ...quotationModuleCategoryOptions.map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
          <SelectInput
            label="Panel Technology"
            value={values.panel_type}
            onChange={(value) => update("panel_type", value)}
            options={[
              { value: "", label: "Select panel technology" },
              ...quotationPanelTechnologyOptions.map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
          <SelectInput
            label="Inverter Type"
            value={values.inverter_type}
            onChange={(value) => update("inverter_type", value)}
            options={[
              { value: "", label: "Select inverter type" },
              ...quotationInverterTypeOptions.map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
          <SelectInput
            label="Site Type"
            value={values.site_type}
            onChange={(value) => update("site_type", value)}
            options={[
              { value: "", label: "Select site type" },
              ...quotationSiteTypeOptions.map((value) => ({ value, label: value })),
            ]}
          />
          <ReadOnlyField
            label="Expected Generation p.a. (kWh)"
            value={values.expected_annual_generation_kwh || "-"}
          />
          <SelectInput
            label="Panel Brand"
            value={values.summary_module_brand}
            onChange={(value) => update("summary_module_brand", value)}
            options={optionsWithCurrentValue(
              panelBrandOptions,
              values.summary_module_brand,
              "Current panel brand",
            )}
          />
          <SelectInput
            label="Panel Wattage (W)"
            value={selectedPanelWattageValue}
            onChange={updatePanelWattage}
            options={[
              { value: "", label: "Select panel wattage" },
              ...panelWattageOptions,
              { value: createPanelWattageValue, label: "Create new wattage" },
            ]}
          />
          {creatingPanelWattage ||
          selectedPanelWattageValue === createPanelWattageValue ? (
            <TextInput
              label="New Panel Wattage (W)"
              value={values.summary_module_wattage}
              onChange={(value) => update("summary_module_wattage", value)}
              type="number"
            />
          ) : null}
          <SelectInput
            label="Inverter Brand"
            value={values.summary_inverter_brand}
            onChange={(value) => update("summary_inverter_brand", value)}
            options={optionsWithCurrentValue(
              inverterBrandOptions,
              values.summary_inverter_brand,
              "Current inverter brand",
            )}
          />
        </Section>
      ) : null}

      {activeTab === "BOM" ? (
        <Section title="Standard Bill Of Material">
          <div className="space-y-3 md:col-span-2">
            <div className="grid gap-3 rounded-lg border border-stone-200 p-3 md:grid-cols-2 xl:grid-cols-[1fr_1.35fr_.9fr_.9fr_1fr_1.2fr_88px_110px_auto]">
              <SelectInput
                label="Category"
                value={bomDraft.product_category_id ?? ""}
                onChange={updateBomDraftCategory}
                options={[
                  { value: "", label: "Category" },
                  ...productCategories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
              />
              <SelectInput
                label="Product"
                value={bomDraft.product_id ?? ""}
                onChange={updateBomDraftProduct}
                options={[
                  { value: "", label: "Product" },
                  ...products
                    .filter(
                      (product) =>
                        product.category_id ===
                        (bomDraft.product_category_id ?? ""),
                    )
                    .map((product) => ({
                      value: product.id,
                      label: productOptionLabel(product),
                    })),
                ]}
              />
              <ReadonlyFormValue
                label="HSN Code"
                value={bomDraft.hsn_code ?? ""}
              />
              <ReadonlyFormValue label="Brand" value={bomDraft.brand ?? ""} />
              <ReadonlyFormValue
                label="Specifications"
                value={bomDraft.specification ?? ""}
              />
              <TextInput
                label="Quantity"
                value={bomDraft.quantity}
                onChange={(value) => updateBomDraft("quantity", value)}
                type="number"
              />
              <SelectInput
                label="Unit"
                value={bomDraft.unit}
                onChange={(value) => updateBomDraft("unit", value)}
                options={[
                  { value: "", label: "Unit" },
                  ...quotationUnitOptions.map((value) => ({ value, label: value })),
                ]}
              />
              <div className="flex items-end">
                <Button onClick={addBomDraft}>Add</Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
                <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Sr.</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">HSN Code</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3">Specifications</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {savedBomItems.length > 0 ? (
                    savedBomItems.map((item, index) => (
                      <tr key={`${item.product_id ?? item.description}-${index}`}>
                        <td className="px-4 py-3">{index + 1}</td>
                        <td className="px-4 py-3">
                          {productCategoryName(
                            productCategories,
                            item.product_category_id,
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {item.description || "-"}
                        </td>
                        <td className="px-4 py-3">{item.hsn_code || "-"}</td>
                        <td className="px-4 py-3">{item.brand || "-"}</td>
                        <td className="px-4 py-3">
                          {item.specification || item.make_specification || "-"}
                        </td>
                        <td className="px-4 py-3">{item.quantity || "-"}</td>
                        <td className="px-4 py-3">{item.unit || "-"}</td>
                        <td className="px-4 py-3">
                          <Button
                            onClick={() => removeBomItem(index)}
                            variant="secondary"
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-4 py-6 text-center text-sm text-slate-500"
                        colSpan={10}
                      >
                        No BOM items added.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      ) : null}

      {activeTab === "Commercial" ? (
        <Section title="Commercial Terms And Scope">
          <TextInput
            label="Total Turnkey Cost"
            value={values.summary_total_turnkey_cost}
            onChange={updateTurnkeyCost}
            type="number"
          />
          <TextInput
            label="Discount Amount"
            value={values.discount_amount}
            onChange={updateDiscountAmount}
            type="number"
          />
          {commercialDiscountedAmount !== null &&
          Number(values.discount_amount || 0) > 0 ? (
            <ReadOnlyField
              label="Discounted Price"
              value={formatMoneyWithPaise(commercialDiscountedAmount)}
            />
          ) : null}
          <ReadOnlyField
            label="Total Amount In Words"
            value={amountInWordsFromTurnkeyCost(
              commercialDiscountedAmount ?? commercialTurnkeyAmount,
              values.summary_amount_in_words,
            )}
          />
          <TurnkeyGstBreakup
            amount={values.summary_total_turnkey_cost}
            discountAmount={values.discount_amount}
          />
          <TextInput
            label="Subsidy Amount"
            value={values.subsidy_amount}
            onChange={(value) => update("subsidy_amount", value)}
            type="number"
          />
          <TextArea
            label="Price Basis"
            value={values.commercial_price_basis}
            onChange={(value) => update("commercial_price_basis", value)}
          />
          <TextArea
            label="GST Terms"
            value={values.commercial_gst_terms}
            onChange={(value) => update("commercial_gst_terms", value)}
          />
          <TextArea
            label="Security Deposit / DISCOM Charges"
            value={values.commercial_security_deposit_terms}
            onChange={(value) =>
              update("commercial_security_deposit_terms", value)
            }
          />
          <TextArea
            label="Transit Insurance"
            value={values.commercial_transit_insurance}
            onChange={(value) => update("commercial_transit_insurance", value)}
          />
          <TextArea
            label="Storage And Insurance At Site"
            value={values.commercial_site_storage_insurance}
            onChange={(value) =>
              update("commercial_site_storage_insurance", value)
            }
          />
          <TextArea
            label="Project Initiation"
            value={values.commercial_project_initiation}
            onChange={(value) => update("commercial_project_initiation", value)}
          />
          <TextArea
            label="Warranty Applicability"
            value={values.commercial_warranty_applicability}
            onChange={(value) => update("commercial_warranty_applicability", value)}
          />
          <TextArea
            label="Included Scope"
            value={values.proposal_included_scope}
            onChange={(value) => update("proposal_included_scope", value)}
          />
          <TextArea
            label="Important Considerations"
            value={values.proposal_important_considerations}
            onChange={(value) =>
              update("proposal_important_considerations", value)
            }
          />
          <TextArea
            label="Client Responsibilities"
            value={values.proposal_client_responsibilities}
            onChange={(value) => update("proposal_client_responsibilities", value)}
          />
          <TextArea
            label="Exclusions"
            value={values.proposal_exclusions}
            onChange={(value) => update("proposal_exclusions", value)}
          />
        </Section>
      ) : null}

      {activeTab === "Warranty & Payment" ? (
        <Section title="Warranty And Payment Terms">
          <div className="space-y-3 md:col-span-2">
            <h2 className="text-sm font-semibold text-slate-950">Warranty Table</h2>
            {values.warranty_rows.map((warranty, index) => (
              <div
                className="grid gap-3 rounded-lg border border-stone-200 p-3 md:grid-cols-[56px_1fr_1.5fr_auto]"
                key={`${warranty.component}-${index}`}
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500">Sr.</p>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    {index + 1}
                  </p>
                </div>
                <TextInput
                  label="Component"
                  value={warranty.component}
                  onChange={(value) => updateWarranty(index, "component", value)}
                />
                <TextArea
                  label="Warranty"
                  value={warranty.warranty_text}
                  onChange={(value) => updateWarranty(index, "warranty_text", value)}
                />
                <div className="flex items-end">
                  <Button
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        warranty_rows: current.warranty_rows.filter(
                          (_, warrantyIndex) => warrantyIndex !== index,
                        ),
                      }))
                    }
                    variant="secondary"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  warranty_rows: [
                    ...current.warranty_rows,
                    { component: "", warranty_text: "" },
                  ],
                }))
              }
              variant="secondary"
            >
              Add Warranty Row
            </Button>
          </div>

          <div className="space-y-3 md:col-span-2">
            <h2 className="text-sm font-semibold text-slate-950">Payment Terms</h2>
            {values.payment_term_rows.map((paymentTerm, index) => (
              <div
                className="grid gap-3 rounded-lg border border-stone-200 p-3 md:grid-cols-[56px_1.5fr_100px_140px_auto]"
                key={`${paymentTerm.milestone}-${index}`}
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500">Sr.</p>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    {index + 1}
                  </p>
                </div>
                <TextInput
                  label="Milestone"
                  value={paymentTerm.milestone}
                  onChange={(value) => updatePaymentTerm(index, "milestone", value)}
                />
                <TextInput
                  label="%"
                  value={paymentTerm.percentage}
                  onChange={(value) => updatePaymentTerm(index, "percentage", value)}
                  type="number"
                />
                <ReadOnlyField
                  label="Amount"
                  value={moneyPreview(paymentTerm.amount)}
                />
                <div className="flex items-end">
                  <Button
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        payment_term_rows: current.payment_term_rows.filter(
                          (_, paymentIndex) => paymentIndex !== index,
                        ),
                      }))
                    }
                    variant="secondary"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  payment_term_rows: [
                    ...current.payment_term_rows,
                    autoCalculatePaymentTerm(
                      { milestone: "", percentage: "", amount: "" },
                      quotationPaymentTermBaseAmount(current),
                    ),
                  ],
                }))
              }
              variant="secondary"
            >
              Add Payment Row
            </Button>
          </div>
        </Section>
      ) : null}

      {activeTab === "Review" ? (
        <Section title="Review And Save">
          <ProposalPreview customerLabel={customerLabel} values={values} />
          <TextArea
            label="Terms And Conditions"
            value={values.terms_and_conditions}
            onChange={(value) => update("terms_and_conditions", value)}
          />
          <TextArea
            label="Internal Notes"
            value={values.notes}
            onChange={(value) => update("notes", value)}
          />
          <div className="flex flex-col-reverse gap-3 md:col-span-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() =>
                navigate(editQuotationId ? `/quotations/${editQuotationId}` : "/quotations")
              }
              variant="secondary"
            >
              Cancel
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? "Saving..." : isEditing ? "Update Quotation" : "Save Quotation"}
            </Button>
          </div>
        </Section>
      ) : null}

      {showBomRequiredAlert ? (
        <AlertDialog
          title="BOM details required"
          description="Please fill BOM details first before saving the quotation."
          onClose={() => setShowBomRequiredAlert(false)}
        />
      ) : null}
    </form>
  );
}

function ReadonlyFormValue({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1 min-h-10 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-slate-700">
        {value || "-"}
      </div>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-normal text-slate-950">
        {title}
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function TurnkeyGstBreakup({
  amount,
  discountAmount,
}: {
  amount: string;
  discountAmount: string;
}) {
  if (!hasTurnkeyGstAmount(amount)) {
    return null;
  }

  const totals = calculateDiscountedTurnkeyTotals(
    Number(amount),
    Number(discountAmount || 0),
  );
  const breakdown = calculateTurnkeyGstBreakdown(totals.totalAmount);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 md:col-span-2">
      <h3 className="text-sm font-semibold text-slate-950">GST Breakup</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <GstBreakupItem
          label="Taxable Amount"
          value={formatMoneyWithPaise(totals.taxableAmount)}
        />
        <GstBreakupItem
          label="CGST"
          value={formatMoneyWithPaise(totals.cgstAmount)}
        />
        <GstBreakupItem
          label="SGST"
          value={formatMoneyWithPaise(totals.sgstAmount)}
        />
        <GstBreakupItem
          label="Total GST"
          value={formatMoneyWithPaise(totals.gstAmount)}
        />
      </dl>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
          <thead className="bg-white text-slate-600">
            <tr>
              <th className="border border-stone-200 px-2 py-2">Component</th>
              <th className="border border-stone-200 px-2 py-2">
                Inclusive Amount
              </th>
              <th className="border border-stone-200 px-2 py-2">GST Rate</th>
              <th className="border border-stone-200 px-2 py-2">GST Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-stone-200 px-2 py-2">70% portion</td>
              <td className="border border-stone-200 px-2 py-2">
                {formatMoneyWithPaise(breakdown.solarInclusiveAmount)}
              </td>
              <td className="border border-stone-200 px-2 py-2">5%</td>
              <td className="border border-stone-200 px-2 py-2">
                {formatMoneyWithPaise(breakdown.solarGstAmount)}
              </td>
            </tr>
            <tr>
              <td className="border border-stone-200 px-2 py-2">30% portion</td>
              <td className="border border-stone-200 px-2 py-2">
                {formatMoneyWithPaise(breakdown.serviceInclusiveAmount)}
              </td>
              <td className="border border-stone-200 px-2 py-2">18%</td>
              <td className="border border-stone-200 px-2 py-2">
                {formatMoneyWithPaise(breakdown.serviceGstAmount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GstBreakupItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-1 min-h-10 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-medium text-slate-950">
        {value || "-"}
      </p>
    </div>
  );
}

function ProposalPreview({
  customerLabel,
  values,
}: {
  customerLabel: string;
  values: QuotationFormValues;
}) {
  const bomRows = values.material_items.filter((item) =>
    [
      item.description,
      item.brand,
      item.specification,
      item.make_specification,
      item.quantity,
      item.unit,
    ].some((value) => value?.trim()),
  );
  const warrantyRows = values.warranty_rows.filter((item) =>
    [item.component, item.warranty_text].some((value) => value.trim()),
  );
  const paymentRows = values.payment_term_rows.filter((item) =>
    [item.milestone, item.percentage, item.amount].some((value) => value.trim()),
  );
  const turnkeyAmount = values.summary_total_turnkey_cost || values.pricing_total_rate;
  const gstBreakdown = calculateTurnkeyGstBreakdown(Number(turnkeyAmount || 0));
  const discountedTotals = calculateDiscountedTurnkeyTotals(
    Number(turnkeyAmount || 0),
    Number(values.discount_amount || 0),
  );
  const payableTurnkeyAmount =
    discountedTurnkeyAmount(turnkeyAmount, values.discount_amount) ??
    Number(turnkeyAmount || 0);

  return (
    <div className="space-y-5 rounded-lg border border-stone-200 bg-white p-4 text-sm text-slate-800 md:col-span-2">
      <div className="border-b border-stone-200 pb-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Technical And Commercial Proposal
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">
          {values.quotation_title || "Solar PV System Proposal"}
        </h2>
        <p className="mt-1 text-slate-600">
          Ref. No.: {values.quotation_code || "Draft"} / Date:{" "}
          {formatDisplayDate(values.quotation_date)}
        </p>
      </div>

      <PreviewBlock title="1. Proposal Prepared / Project Summary">
        <PreviewGrid
          rows={[
            ["Prepared For", customerLabel || "-"],
            ["Location / Address", values.installation_location || "-"],
            ["City / Village", values.customer_city_village || "-"],
            ["DISCOM", values.discom || "-"],
            ["Proposed Installation Size", valueWithUnit(values.system_capacity_kw, "kW")],
            ["System Type", values.system_type || "-"],
            ["Panel Category", values.module_category || "-"],
            ["Site Type", values.site_type || "-"],
            [
              "Expected Generation p.a.",
              valueWithUnit(values.expected_annual_generation_kwh, "kWh"),
            ],
          ]}
        />
      </PreviewBlock>

      <PreviewBlock title="2. Standard Bill Of Material">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead className="bg-stone-100 text-slate-600">
              <tr>
                <th className="border border-stone-200 px-2 py-2">Sr.</th>
                <th className="border border-stone-200 px-2 py-2">Material</th>
                <th className="border border-stone-200 px-2 py-2">Brand</th>
                <th className="border border-stone-200 px-2 py-2">Specifications</th>
                <th className="border border-stone-200 px-2 py-2">Qty</th>
                <th className="border border-stone-200 px-2 py-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {bomRows.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="border border-stone-200 px-2 py-2">{index + 1}</td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.description || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.brand || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.specification || item.make_specification || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.quantity || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.unit || "pcs"}
                  </td>
                </tr>
              ))}
              {bomRows.length === 0 ? (
                <tr>
                  <td className="border border-stone-200 px-2 py-3 text-center" colSpan={6}>
                    No BOM rows added.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      <PreviewBlock title="3. Quotation Summary">
        <PreviewGrid
          rows={[
            ["Panel Brand", values.summary_module_brand || "-"],
            ["Panel Wattage", valueWithUnit(values.summary_module_wattage, "W")],
            ["Inverter Brand", values.summary_inverter_brand || "-"],
            ["Total Turnkey Cost", moneyPreview(turnkeyAmount)],
            ["Base Amount", moneyPreviewFromNumber(gstBreakdown.taxableAmount)],
            ["Discount", moneyPreview(values.discount_amount)],
            ["Total Amount", moneyPreviewFromNumber(payableTurnkeyAmount)],
            ["Taxable After Discount", moneyPreviewFromNumber(discountedTotals.taxableAmount)],
            ["CGST", moneyPreviewFromNumber(discountedTotals.cgstAmount)],
            ["SGST", moneyPreviewFromNumber(discountedTotals.sgstAmount)],
            ["Total GST", moneyPreviewFromNumber(discountedTotals.gstAmount)],
            ["Subsidy", moneyPreview(values.subsidy_amount)],
            [
              "Total Amount In Words",
              amountInWordsFromTurnkeyCost(
                payableTurnkeyAmount,
                values.summary_amount_in_words || "-",
              ),
            ],
          ]}
        />
      </PreviewBlock>

      <PreviewBlock title="4. Commercial Terms And Conditions">
        <PreviewText label="Price Basis" value={values.commercial_price_basis} />
        <PreviewText label="GST Terms" value={values.commercial_gst_terms} />
        <PreviewText
          label="Security Deposit / DISCOM Charges"
          value={values.commercial_security_deposit_terms}
        />
        <PreviewText label="Transit Insurance" value={values.commercial_transit_insurance} />
        <PreviewText
          label="Storage And Insurance At Site"
          value={values.commercial_site_storage_insurance}
        />
        <PreviewText label="Project Initiation" value={values.commercial_project_initiation} />
        <PreviewText
          label="Warranty Applicability"
          value={values.commercial_warranty_applicability}
        />
      </PreviewBlock>

      <PreviewBlock title="5. Important Considerations / Exclusions">
        <PreviewText label="Included Scope" value={values.proposal_included_scope} />
        <PreviewText
          label="Important Considerations"
          value={values.proposal_important_considerations}
        />
        <PreviewText
          label="Client Responsibilities"
          value={values.proposal_client_responsibilities}
        />
        <PreviewText label="Exclusions" value={values.proposal_exclusions} />
      </PreviewBlock>

      <PreviewBlock title="6. Warranty Table">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-stone-100 text-slate-600">
              <tr>
                <th className="border border-stone-200 px-2 py-2">Sr.</th>
                <th className="border border-stone-200 px-2 py-2">Component</th>
                <th className="border border-stone-200 px-2 py-2">Warranty</th>
              </tr>
            </thead>
            <tbody>
              {warrantyRows.map((item, index) => (
                <tr key={`${item.component}-${index}`}>
                  <td className="border border-stone-200 px-2 py-2">{index + 1}</td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.component || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.warranty_text || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      <PreviewBlock title="7. Payment Terms">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-stone-100 text-slate-600">
              <tr>
                <th className="border border-stone-200 px-2 py-2">Sr.</th>
                <th className="border border-stone-200 px-2 py-2">Particulars</th>
                <th className="border border-stone-200 px-2 py-2">Percentage</th>
                <th className="border border-stone-200 px-2 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((item, index) => (
                <tr key={`${item.milestone}-${index}`}>
                  <td className="border border-stone-200 px-2 py-2">{index + 1}</td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.milestone || "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {item.percentage ? `${item.percentage}%` : "-"}
                  </td>
                  <td className="border border-stone-200 px-2 py-2">
                    {moneyPreview(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      <div className="pt-4 text-right">
        <p className="text-sm font-semibold text-slate-950">Authorized Signature</p>
        <div className="ml-auto mt-8 h-px w-48 bg-stone-300" />
      </div>
    </div>
  );
}

function PreviewBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-stone-200 pb-2 text-base font-semibold text-slate-950">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PreviewGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div className="rounded-lg bg-stone-50 p-3" key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </dt>
          <dd className="mt-1 font-medium text-slate-950">{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

function PreviewText({ label, value }: { label: string; value: string }) {
  if (!value.trim()) {
    return null;
  }

  return (
    <div>
      <p className="font-semibold text-slate-950">{label}</p>
      <p className="mt-1 whitespace-pre-line leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function newQuotationDefaults(values: QuotationFormValues): QuotationFormValues {
  const validUntil =
    quotationValidUntilFromDateInput(values.quotation_date) || values.valid_until;
  const paymentTermRows =
    values.payment_term_rows.length > 0
      ? values.payment_term_rows
      : defaultTechnicalPaymentTerms.map((item) => ({ ...item }));
  const totalTurnkeyCost =
    values.summary_total_turnkey_cost || values.pricing_total_rate;
  const payableTurnkeyAmount = discountedTurnkeyAmount(
    totalTurnkeyCost,
    values.discount_amount,
  );
  const expectedGeneration =
    values.expected_annual_generation_kwh ||
    calculateExpectedAnnualGenerationInput(values.system_capacity_kw);

  return {
    ...values,
    valid_until: validUntil,
    quotation_title:
      values.quotation_title ||
      buildQuotationTitle(
        values.system_capacity_kw,
        values.module_category,
        values.customer_type,
      ),
    summary_plant_size_kw: values.summary_plant_size_kw || values.system_capacity_kw,
    expected_annual_generation_kwh: expectedGeneration,
    estimated_generation_units: expectedGeneration,
    summary_total_turnkey_cost:
      values.summary_total_turnkey_cost || values.pricing_total_rate,
    pricing_total_rate:
      values.pricing_total_rate || values.summary_total_turnkey_cost,
    summary_amount_in_words: amountInWordsFromTurnkeyCost(
      payableTurnkeyAmount ?? totalTurnkeyCost,
      values.summary_amount_in_words,
    ),
    work_description:
      values.work_description ||
      "Supply, installation, testing and commissioning of the proposed solar PV power plant.",
    payment_term_rows: autoCalculatePaymentTermRows(
      paymentTermRows,
      payableTurnkeyAmount ?? totalTurnkeyCost,
    ),
  };
}

function prepareNewQuotationValues(values: QuotationFormValues): QuotationFormValues {
  const preparedValues = newQuotationDefaults(values);
  const material_items = preparedValues.material_items
    .filter(hasSavedBomItem)
    .map((item) => ({
      ...item,
      brand: item.brand ?? "",
      specification: item.specification ?? "",
      make_specification:
        [item.brand, item.specification].filter(Boolean).join(" / ") ||
        item.make_specification,
    }));
  const materialSummary = deriveQuotationMaterialSummary(material_items);
  return {
    ...preparedValues,
    material_items,
    payment_term_rows: autoCalculatePaymentTermRows(
      preparedValues.payment_term_rows,
      quotationPaymentTermBaseAmount(preparedValues),
    ),
    summary_module_brand:
      preparedValues.summary_module_brand ||
      materialSummary.summary_module_brand ||
      "",
    summary_module_wattage:
      preparedValues.summary_module_wattage ||
      materialSummary.summary_module_wattage ||
      "",
    summary_inverter_brand:
      preparedValues.summary_inverter_brand ||
      materialSummary.summary_inverter_brand ||
      "",
    summary_earthing_count:
      preparedValues.summary_earthing_count ||
      materialSummary.summary_earthing_count ||
      "",
  };
}

function customerName(customerId: string, customers: SurveyCustomerSummary[]) {
  const customer = customers.find((option) => option.id === customerId);
  return customer ? customerOptionLabel(customer) : "";
}

function leadName(leadId: string, leads: SurveyLeadSummary[]) {
  const lead = leads.find((option) => option.id === leadId);
  return lead ? leadOptionLabel(lead) : "";
}

function applyLeadToCurrentQuotation(
  current: QuotationFormValues,
  lead: SurveyLeadSummary,
  customers: SurveyCustomerSummary[],
) {
  const leadValues = leadToQuotationForm(lead);
  const systemCapacity = leadValues.system_capacity_kw || current.system_capacity_kw;
  const expectedGeneration =
    calculateExpectedAnnualGenerationInput(systemCapacity);
  const totalTurnkeyCost =
    leadValues.summary_total_turnkey_cost || current.summary_total_turnkey_cost;
  const linkedCustomer = customers.find(
    (customer) =>
      customer.id === (lead.converted_customer_id ?? lead.customer_id ?? ""),
  );
  const linkedCustomerType = normalizeQuotationCustomerType(
    linkedCustomer?.customer_type,
  );

  return newQuotationDefaults({
    ...current,
    customer_id: leadValues.customer_id,
    lead_id: leadValues.lead_id,
    system_capacity_kw: systemCapacity,
    expected_annual_generation_kwh: expectedGeneration,
    estimated_generation_units: expectedGeneration,
    summary_total_turnkey_cost: totalTurnkeyCost,
    pricing_total_rate:
      leadValues.pricing_total_rate || current.pricing_total_rate || totalTurnkeyCost,
    summary_plant_size_kw:
      leadValues.summary_plant_size_kw ||
      current.summary_plant_size_kw ||
      systemCapacity,
    quotation_title: buildQuotationTitle(
      systemCapacity,
      current.module_category || leadValues.module_category,
      linkedCustomerType || leadValues.customer_type || current.customer_type,
    ),
    system_type: leadValues.system_type || current.system_type,
    customer_type:
      linkedCustomerType || leadValues.customer_type || current.customer_type,
    customer_city_village:
      leadValues.customer_city_village || current.customer_city_village,
    site_type: leadValues.site_type || current.site_type,
    installation_location:
      leadValues.installation_location || current.installation_location,
  });
}

function materialItemWithProduct(
  item: QuotationMaterialItem,
  productId: string,
  products: Product[],
): QuotationMaterialItem {
  const product = products.find((candidate) => candidate.id === productId);

  if (!product) {
    return {
      ...item,
      product_id: "",
      inventory_item_id: "",
      hsn_code: "",
      description: "",
      brand: "",
      specification: "",
      make_specification: "",
    };
  }

  const specification = product.specifications ?? product.model_number ?? "";

  return {
    ...item,
    product_category_id: product.category_id,
    product_id: product.id,
    inventory_item_id: "",
    hsn_code: product.hsn_code ?? "",
    description: product.product_name,
    brand: product.brand ?? "",
    specification,
    make_specification:
      [product.brand, specification].filter(Boolean).join(" / ") ||
      item.make_specification,
    unit: product.unit || item.unit,
  };
}

function emptyMaterialItem(): QuotationMaterialItem {
  return {
    inventory_item_id: "",
    product_category_id: "",
    product_id: "",
    hsn_code: "",
    description: "",
    brand: "",
    specification: "",
    make_specification: "",
    quantity: "",
    unit: "pcs",
  };
}

function hasSavedBomItem(item: QuotationMaterialItem) {
  return Boolean(
    item.product_id ||
      (item.description.trim() &&
        [
          item.hsn_code,
          item.brand,
          item.specification,
          item.make_specification,
          item.quantity,
          item.unit,
        ].some((value) => (value ?? "").trim())),
  );
}

function productCategoryName(
  categories: ProductCategory[],
  categoryId: string | undefined,
) {
  return categories.find((category) => category.id === categoryId)?.name ?? "-";
}

function productOptionLabel(product: Product) {
  const metadata = [
    product.hsn_code ? `HSN: ${product.hsn_code}` : "",
  ].filter(Boolean);

  return metadata.length > 0
    ? `${product.product_name} (${metadata.join(" / ")})`
    : product.product_name;
}

function inventoryBrandOptions(items: InventoryItem[], placeholder: string) {
  const brandsByName = new Map<string, { name: string; products: Set<string> }>();

  items.forEach((item) => {
    const brand = inventoryBrandName(item).trim();
    if (!brand) {
      return;
    }

    const key = brand.toLowerCase();
    const option = brandsByName.get(key) ?? {
      name: brand,
      products: new Set<string>(),
    };
    const title = inventoryProductHint(item);
    if (title) {
      option.products.add(title);
    }
    brandsByName.set(key, option);
  });

  const options = Array.from(brandsByName.values())
    .sort((first, second) => first.name.localeCompare(second.name))
    .map((brand) => {
      const products = Array.from(brand.products);
      const productHint =
        products.length === 1
          ? products[0]
          : products.length > 1
            ? `${products.length} products`
            : "";

      return {
        value: brand.name,
        label: productHint ? `${brand.name} - ${productHint}` : brand.name,
      };
    });

  return [{ value: "", label: placeholder }, ...options];
}

function inventoryProductHint(item: InventoryItem) {
  return [inventoryProductName(item), inventoryModelName(item)]
    .filter(Boolean)
    .join(" / ");
}

function panelWattageSelectOptions(items: InventoryItem[]) {
  const wattages = new Set(standardPanelWattages);

  items.forEach((item) => {
    const wattage = wattageFromInventoryItem(item);
    if (wattage) {
      wattages.add(wattage);
    }
  });

  return Array.from(wattages)
    .sort((first, second) => Number(first) - Number(second))
    .map((wattage) => ({
      value: wattage,
      label: `${wattage} W`,
    }));
}

function wattageFromInventoryItem(item: InventoryItem) {
  return wattageFromText(
    [
      item.item_name,
      inventoryModelName(item),
      item.model,
      item.notes,
    ].join(" "),
  );
}

function wattageFromText(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:wp|watt(?:s)?|w)\b/i);
  return match?.[1] ?? "";
}

function optionsWithCurrentValue(
  options: Array<{ value: string; label: string }>,
  currentValue: string,
  currentLabel: string,
) {
  const trimmedValue = currentValue.trim();

  if (
    !trimmedValue ||
    options.some(
      (option) => option.value.toLowerCase() === trimmedValue.toLowerCase(),
    )
  ) {
    return options;
  }

  return [
    ...options,
    {
      value: currentValue,
      label: `${currentLabel}: ${currentValue}`,
    },
  ];
}

function valueWithUnit(value: string, unit: string) {
  return value.trim() ? `${value} ${unit}` : "-";
}

function moneyPreview(value: string) {
  const amount = Number(value);
  if (!value.trim() || !Number.isFinite(amount)) {
    return "-";
  }

  return formatMoneyWithPaise(amount);
}

function moneyPreviewFromNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return formatMoneyWithPaise(value);
}

function autoCalculatePaymentTermRows(
  rows: QuotationPaymentTermFormValues[],
  totalAmount: number | string | null | undefined,
) {
  return rows.map((row) => autoCalculatePaymentTerm(row, totalAmount));
}

function autoCalculatePaymentTerm(
  row: QuotationPaymentTermFormValues,
  totalAmount: number | string | null | undefined,
): QuotationPaymentTermFormValues {
  return {
    ...row,
    amount: calculatePaymentTermAmount(row.percentage, totalAmount),
  };
}

function calculatePaymentTermAmount(
  percentage: string,
  totalAmount: number | string | null | undefined,
) {
  const amount = Number(totalAmount || 0);
  const percent = Number(percentage || 0);

  if (!Number.isFinite(amount) || !Number.isFinite(percent) || amount <= 0) {
    return "";
  }

  return String(Math.round((amount * percent / 100) * 100) / 100);
}

function quotationPaymentTermBaseAmount(values: QuotationFormValues) {
  const turnkeyAmount =
    values.summary_total_turnkey_cost || values.pricing_total_rate;

  return discountedTurnkeyAmount(turnkeyAmount, values.discount_amount) ??
    turnkeyAmount;
}

