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
  createProduct,
  fetchProductCategories,
  fetchProducts,
} from "../product-master/productMasterApi";
import type {
  Product,
  ProductCategory,
  ProductFormValues,
} from "../product-master/types";
import { ProductFormModal } from "../product-master/ProductMasterComponents";
import {
  buildGeneratedProductName,
  emptyProductForm,
  validateProductForm,
} from "../product-master/productMasterUtils";
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
  quotationModuleCategoryOptions,
  quotationPanelTechnologyOptions,
  quotationSiteTypeOptions,
  quotationSystemTypeOptions,
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
import {
  categoryForQuotationBomRow,
  mergeQuotationBomTemplateRows,
  productsForQuotationBomRow,
} from "./quotationBomTemplate";
import { QuotationProductSelect } from "./QuotationProductSelect";
import {
  quotationMaterialItemWithProduct,
  quotationQuickProductIdentificationError,
} from "./quotationQuickProduct";
import { fetchQuotationPackages } from "../quotation-packages/quotationPackageApi";
import type { QuotationPackage } from "../quotation-packages/types";

const tabs = [
  "Project",
  "BOM",
  "Commercial",
  "Warranty & Payment",
  "Review",
];

type QuickProductTarget =
  | {
      kind: "row";
      index: number;
      categoryId: string;
      categoryName: string;
    }
  | {
      kind: "draft";
      categoryId: string;
      categoryName: string;
    };

type QuickProductFormState = {
  target: QuickProductTarget;
  values: ProductFormValues;
};

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
  const [quotationPackages, setQuotationPackages] = useState<QuotationPackage[]>([]);
  const [quickProductForm, setQuickProductForm] =
    useState<QuickProductFormState | null>(null);
  const [quickProductErrors, setQuickProductErrors] = useState<
    Record<string, string>
  >({});
  const [quickProductSaving, setQuickProductSaving] = useState(false);
  const [quickProductAlert, setQuickProductAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
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
  const canCreateProduct = hasPermission(
    profile,
    permissions,
    "product_master",
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
          nextQuotationPackages,
          nextSettings,
          currentQuotation,
        ] = await Promise.all([
          fetchQuotationCustomers(profile),
          fetchQuotationLeads(profile),
          fetchQuotationSiteSurveys(profile),
          fetchProductCategories(profile),
          fetchProducts(profile),
          fetchQuotationPackages(profile, true),
          fetchOrganizationSettings().catch(() => null),
          editQuotationId ? fetchQuotation(profile, editQuotationId) : null,
        ]);
        setCustomers(nextCustomers);
        setLeads(nextLeads);
        setSiteSurveys(nextSiteSurveys);
        setProductCategories(
          nextProductCategories.filter((category) => category.is_active !== false),
        );
        const packageProductIds = new Set(
          nextQuotationPackages.flatMap((quotationPackage) =>
            quotationPackage.items.map((item) => item.product_id),
          ),
        );
        setProducts(
          nextProducts.filter(
            (product) =>
              product.status === "active" || packageProductIds.has(product.id),
          ),
        );
        setQuotationPackages(nextQuotationPackages);
        if (editQuotationId) {
          if (!currentQuotation) {
            setLoadError("Quotation could not be found.");
            return;
          }

          const currentValues = quotationToForm(currentQuotation);
          setValues(
            newQuotationDefaults({
              ...currentValues,
              material_items: syncBomProductUnits(
                mergeQuotationBomTemplateRows(
                  nextProductCategories,
                  currentValues.material_items,
                ),
                nextProducts,
              ),
            }),
          );
          return;
        }

        const nextQuotationCode = await fetchNextQuotationCode(
          profile,
          nextSettings?.quotation_prefix,
        );
        setValues((current) => ({
          ...current,
          quotation_code: current.quotation_code || nextQuotationCode,
          material_items: mergeQuotationBomTemplateRows(
            nextProductCategories,
            current.material_items,
          ),
        }));
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
                material_items: current.material_items,
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
                material_items: current.material_items,
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
  const selectedQuotationPackage = useMemo(
    () =>
      quotationPackages.find(
        (quotationPackage) => quotationPackage.id === values.quotation_package_id,
      ) ?? null,
    [quotationPackages, values.quotation_package_id],
  );
  const quickProductBrandOptions = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((product) => product.brand?.trim())
            .filter((brand): brand is string => Boolean(brand)),
        ),
      ).sort((first, second) => first.localeCompare(second)),
    [products],
  );
  const savedBomItems = useMemo(
    () => values.material_items.filter(hasSavedBomItem),
    [values.material_items],
  );
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

  function updateQuotationPackage(packageId: string) {
    if (!packageId) {
      setValues((current) => ({ ...current, quotation_package_id: "" }));
      return;
    }

    const quotationPackage = quotationPackages.find(
      (candidate) => candidate.id === packageId,
    );
    if (!quotationPackage) {
      return;
    }

    const packageMaterials = quotationPackage.items.map((item) => ({
      inventory_item_id: "",
      product_category_id:
        products.find((product) => product.id === item.product_id)?.category_id ?? "",
      product_id: item.product_id,
      hsn_code: item.hsn_code ?? "",
      description: item.product_name,
      brand: item.brand ?? "",
      model_number: item.model_number ?? "",
      specification: item.specification ?? "",
      make_specification: [item.brand, item.model_number, item.specification]
        .filter(Boolean)
        .join(" / "),
      quantity: String(item.quantity),
      unit: item.unit,
    }));

    setValues((current) =>
      newQuotationDefaults({
        ...current,
        quotation_package_id: quotationPackage.id,
        material_items: packageMaterials,
        summary_total_turnkey_cost: String(quotationPackage.commercial_cost),
        pricing_total_rate: String(quotationPackage.commercial_cost),
      }),
    );
    setActiveTab("BOM");
    showToast(`${quotationPackage.name} applied. Review the BOM, then finish commercials.`, "success");
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

  function updateSystemType(systemType: string) {
    setValues((current) => ({
      ...current,
      system_type: systemType,
      inverter_type: systemType,
    }));
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
      model_number: "",
      specification: "",
      make_specification: "",
    }));
  }

  function updateBomDraftProduct(productId: string) {
    setBomDraft((current) =>
      quotationMaterialItemWithProduct(current, productId, products),
    );
  }

  function updateBomDraft(key: keyof QuotationMaterialItem, value: string) {
    setBomDraft((current) => ({ ...current, [key]: value }));
  }

  function openQuickProductCreate(target: QuickProductTarget) {
    const initialValues = emptyProductForm();
    setQuickProductErrors({});
    setQuickProductAlert(null);
    setQuickProductForm({
      target,
      values: {
        ...initialValues,
        category_id: target.categoryId,
        status: "active",
      },
    });
  }

  function updateQuickProductValues(nextValues: ProductFormValues) {
    if (!quickProductForm) {
      return;
    }

    const enforcedValues = {
      ...nextValues,
      category_id:
        quickProductForm.target.categoryId || nextValues.category_id,
      status: "active" as const,
    };
    const baseErrors = validateProductForm(enforcedValues);

    setQuickProductForm({
      ...quickProductForm,
      values: enforcedValues,
    });
    setQuickProductErrors((current) => ({
      ...current,
      category_id: baseErrors.category_id,
      product_name: baseErrors.product_name,
      unit: baseErrors.unit,
      gst_percent: baseErrors.gst_percent,
      identifying_details:
        quotationQuickProductIdentificationError(enforcedValues),
    }));
  }

  async function handleQuickProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!quickProductForm || !canCreateProduct) {
      return;
    }

    const categoryId =
      quickProductForm.target.categoryId || quickProductForm.values.category_id;
    const preparedValues: ProductFormValues = {
      ...quickProductForm.values,
      category_id: categoryId,
      status: "active",
      product_name: buildGeneratedProductName(
        { ...quickProductForm.values, category_id: categoryId, status: "active" },
        productCategories,
      ),
    };
    const nextErrors = {
      ...validateProductForm(preparedValues),
      identifying_details:
        quotationQuickProductIdentificationError(preparedValues),
    };
    setQuickProductErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setQuickProductSaving(true);
      const createdProduct = await createProduct(profile, preparedValues);

      setProducts((current) => [
        ...current.filter((product) => product.id !== createdProduct.id),
        createdProduct,
      ]);

      if (quickProductForm.target.kind === "row") {
        const targetIndex = quickProductForm.target.index;
        setValues((current) => ({
          ...current,
          material_items: current.material_items.map((item, index) =>
            index === targetIndex
              ? quotationMaterialItemWithProduct(
                  item,
                  createdProduct.id,
                  [createdProduct],
                )
              : item,
          ),
        }));
      } else {
        setBomDraft((current) =>
          quotationMaterialItemWithProduct(
            current,
            createdProduct.id,
            [createdProduct],
          ),
        );
      }

      setQuickProductForm(null);
      setQuickProductErrors({});
      showToast("Product or material added and selected.", "success");
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "Product or material save failed.";
      setQuickProductAlert({
        title: "Product or material could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setQuickProductSaving(false);
    }
  }

  function updateBomRowProduct(index: number, productId: string) {
    setValues((current) => ({
      ...current,
      material_items: current.material_items.map((item, itemIndex) =>
        itemIndex === index
          ? quotationMaterialItemWithProduct(item, productId, products)
          : item,
      ),
    }));
  }

  function updateBomRow(
    index: number,
    key: "quantity" | "brand" | "model_number" | "specification",
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      material_items: current.material_items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: value,
              make_specification: [
                key === "brand" ? value : item.brand,
                key === "model_number" ? value : item.model_number,
                key === "specification" ? value : item.specification,
              ]
                .filter(Boolean)
                .join(" / "),
            }
          : item,
      ),
    }));
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
      material_items: [...current.material_items, bomDraft],
    }));
    setBomDraft(emptyMaterialItem());
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
            prepareNewQuotationValues(values, products),
          )
        : await createQuotation(
            profile,
            prepareNewQuotationValues(values, products),
          );

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
            onChange={updateSystemType}
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
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-slate-700 md:col-span-2">
            <span className="font-semibold text-slate-950">How this is calculated: </span>
            System capacity × 4 peak-sun-hours per day × 365 days. This is an
            indicative annual estimate; actual generation depends on site shading,
            orientation, weather, and system performance.
          </div>
        </Section>
      ) : null}

      {activeTab === "BOM" ? (
        <Section title="Standard Bill Of Material">
          <div className="space-y-4 md:col-span-2">
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <SelectInput
                    label="Start with a quotation package"
                    onChange={updateQuotationPackage}
                    options={[
                      { value: "", label: "Build this quotation manually" },
                      ...quotationPackages
                        .filter(
                          (quotationPackage) =>
                            quotationPackage.is_active ||
                            quotationPackage.id === values.quotation_package_id,
                        )
                        .map((quotationPackage) => ({
                          value: quotationPackage.id,
                          label: `${quotationPackage.name} — ${formatMoneyWithPaise(quotationPackage.commercial_cost)}`,
                        })),
                    ]}
                    value={values.quotation_package_id}
                  />
                </div>
                <p className="pb-2 text-sm text-slate-700">
                  {selectedQuotationPackage
                    ? `${selectedQuotationPackage.items.length} products and the package cost are ready to review.`
                    : "Apply products and commercial cost in one step."}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Products from a package appear here ready to review. You can change
              the product, brand, model, specification, or quantity for this quotation.
            </p>

            <div className="space-y-3 md:hidden">
              {values.material_items.map((item, index) => {
                const rowProducts = productsForQuotationBomRow(
                  item,
                  products,
                  productCategories,
                );
                const categoryLabel = bomCategoryLabel(item, productCategories);
                const productCategory = categoryForQuotationBomRow(
                  item,
                  productCategories,
                );

                return (
                  <article
                    className="rounded-xl border border-stone-200 bg-white p-4"
                    key={item.bom_category_key ?? `${item.product_id ?? "item"}-${index}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Category {index + 1}
                        </p>
                        <h3 className="mt-1 font-semibold text-slate-950">
                          {categoryLabel}
                        </h3>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <QuotationProductSelect
                        ariaLabel={`Product for ${categoryLabel}`}
                        canCreateProduct={canCreateProduct}
                        categoryName={categoryLabel}
                        label="Product"
                        onChange={(value) => updateBomRowProduct(index, value)}
                        onAddProduct={() =>
                          openQuickProductCreate({
                            kind: "row",
                            index,
                            categoryId: productCategory?.id ?? "",
                            categoryName: categoryLabel,
                          })
                        }
                        products={rowProducts}
                        value={item.product_id ?? ""}
                      />
                      <TextInput
                        label="Quantity"
                        value={item.quantity}
                        onChange={(value) => updateBomRow(index, "quantity", value)}
                        type="number"
                      />
                      <ReadonlyFormValue label="HSN Code" value={item.hsn_code ?? ""} />
                      <TextInput
                        label="Brand"
                        value={item.brand ?? ""}
                        onChange={(value) => updateBomRow(index, "brand", value)}
                      />
                      <TextInput
                        label="Model"
                        value={item.model_number ?? ""}
                        onChange={(value) => updateBomRow(index, "model_number", value)}
                      />
                      <TextInput
                        label="Specifications"
                        value={item.specification ?? ""}
                        onChange={(value) => updateBomRow(index, "specification", value)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-stone-200 md:block">
              <table className="min-w-[1220px] w-full border-collapse text-left text-sm">
                <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Sr.</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">HSN Code</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Specifications</th>
                    <th className="px-4 py-3">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {values.material_items.map((item, index) => {
                    const rowProducts = productsForQuotationBomRow(
                      item,
                      products,
                      productCategories,
                    );
                    const categoryLabel = bomCategoryLabel(item, productCategories);
                    const productCategory = categoryForQuotationBomRow(
                      item,
                      productCategories,
                    );

                    return (
                      <tr
                        key={item.bom_category_key ?? `${item.product_id ?? "item"}-${index}`}
                      >
                        <td className="px-4 py-3">{index + 1}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {categoryLabel}
                        </td>
                        <td className="min-w-64 px-4 py-3">
                          <QuotationProductSelect
                            ariaLabel={`Product for ${categoryLabel}`}
                            canCreateProduct={canCreateProduct}
                            categoryName={categoryLabel}
                            onAddProduct={() =>
                              openQuickProductCreate({
                                kind: "row",
                                index,
                                categoryId: productCategory?.id ?? "",
                                categoryName: categoryLabel,
                              })
                            }
                            onChange={(productId) =>
                              updateBomRowProduct(index, productId)
                            }
                            products={rowProducts}
                            showLabel={false}
                            value={item.product_id ?? ""}
                          />
                        </td>
                        <td className="px-4 py-3">{item.hsn_code || "-"}</td>
                        <td className="min-w-36 px-4 py-3">
                          <input
                            aria-label={`Brand for ${bomCategoryLabel(item, productCategories)}`}
                            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                            value={item.brand ?? ""}
                            onChange={(event) =>
                              updateBomRow(index, "brand", event.target.value)
                            }
                          />
                        </td>
                        <td className="min-w-40 px-4 py-3">
                          <input
                            aria-label={`Model for ${bomCategoryLabel(item, productCategories)}`}
                            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                            value={item.model_number ?? ""}
                            onChange={(event) =>
                              updateBomRow(index, "model_number", event.target.value)
                            }
                          />
                        </td>
                        <td className="min-w-48 px-4 py-3">
                          <input
                            aria-label={`Specifications for ${bomCategoryLabel(item, productCategories)}`}
                            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                            value={item.specification ?? ""}
                            onChange={(event) =>
                              updateBomRow(index, "specification", event.target.value)
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            aria-label={`Quantity for ${bomCategoryLabel(item, productCategories)}`}
                            className="w-24 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                            min="0"
                            type="number"
                            value={item.quantity}
                            onChange={(event) =>
                              updateBomRow(index, "quantity", event.target.value)
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
              <h3 className="font-semibold text-slate-950">Add another BOM item</h3>
              <p className="mt-1 text-sm text-slate-600">
                Use this only when the required material is outside the standard categories.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.35fr_.9fr_.9fr_1fr_1.2fr_88px_auto]">
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
                <QuotationProductSelect
                  canCreateProduct={canCreateProduct}
                  categoryName={
                    productCategories.find(
                      (category) => category.id === bomDraft.product_category_id,
                    )?.name ?? "product"
                  }
                  disabled={!bomDraft.product_category_id}
                  label="Product"
                  onChange={updateBomDraftProduct}
                  onAddProduct={
                    bomDraft.product_category_id
                      ? () => {
                          const category = productCategories.find(
                            (candidate) =>
                              candidate.id === bomDraft.product_category_id,
                          );
                          openQuickProductCreate({
                            kind: "draft",
                            categoryId: bomDraft.product_category_id ?? "",
                            categoryName: category?.name ?? "product",
                          });
                        }
                      : undefined
                  }
                  placeholder={
                    bomDraft.product_category_id ? "Select product" : "Select category first"
                  }
                  products={products.filter(
                    (product) =>
                      product.category_id === (bomDraft.product_category_id ?? ""),
                  )}
                  value={bomDraft.product_id ?? ""}
                />
                <ReadonlyFormValue label="HSN Code" value={bomDraft.hsn_code ?? ""} />
                <ReadonlyFormValue label="Brand" value={bomDraft.brand ?? ""} />
                <ReadonlyFormValue label="Model" value={bomDraft.model_number ?? ""} />
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
                <div className="flex items-end">
                  <Button onClick={addBomDraft}>Add</Button>
                </div>
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      {activeTab === "Commercial" ? (
        <Section title="Commercial Terms And Scope">
          {selectedQuotationPackage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:col-span-2">
              <p className="font-semibold text-slate-950">
                {selectedQuotationPackage.name} package price applied
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {formatMoneyWithPaise(selectedQuotationPackage.commercial_cost)} has been copied as the turnkey cost. You can still adjust it for this customer.
              </p>
            </div>
          ) : null}
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
          <div className="space-y-2 md:col-span-2">
            <h2 className="text-sm font-semibold text-slate-950">Warranty Table</h2>
            {values.warranty_rows.map((warranty, index) => (
              <div
                className="grid items-start gap-2 rounded-lg border border-stone-200 p-2 md:grid-cols-[44px_1fr_1.5fr_auto]"
                key={`${warranty.component}-${index}`}
              >
                <div>
                  <p className="text-xs font-semibold text-slate-500">Sr.</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {index + 1}
                  </p>
                </div>
                <TextInput
                  label="Component"
                  value={warranty.component}
                  onChange={(value) => updateWarranty(index, "component", value)}
                />
                <TextInput
                  label="Warranty"
                  value={warranty.warranty_text}
                  onChange={(value) => updateWarranty(index, "warranty_text", value)}
                />
                <div className="flex items-end self-end">
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
                <div className="flex items-end self-end md:-translate-y-1">
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

      {quickProductForm ? (
        <ProductFormModal
          brandOptions={quickProductBrandOptions}
          categories={productCategories}
          errors={quickProductErrors}
          fixedCategoryId={quickProductForm.target.categoryId || undefined}
          forceActive
          mode="quotation-quick"
          onClose={() => {
            if (!quickProductSaving) {
              setQuickProductForm(null);
              setQuickProductErrors({});
            }
          }}
          onSubmit={handleQuickProductSubmit}
          saving={quickProductSaving}
          setValues={updateQuickProductValues}
          title={`Add ${quickProductForm.target.categoryName}`}
          values={quickProductForm.values}
        />
      ) : null}

      {quickProductAlert ? (
        <AlertDialog
          description={quickProductAlert.description}
          onClose={() => setQuickProductAlert(null)}
          title={quickProductAlert.title}
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
  const bomRows = values.material_items.filter(hasSavedBomItem);
  const materialSummary = deriveQuotationMaterialSummary(bomRows);
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
          Ref. No.: {values.quotation_code || "Created"} / Date:{" "}
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
            ["Panel Brand", materialSummary.summary_module_brand || "-"],
            ["Panel Wattage", valueWithUnit(materialSummary.summary_module_wattage || "", "W")],
            ["Inverter Brand", materialSummary.summary_inverter_brand || "-"],
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

function prepareNewQuotationValues(
  values: QuotationFormValues,
  products: Product[],
): QuotationFormValues {
  const preparedValues = newQuotationDefaults(values);
  const material_items = syncBomProductUnits(
    preparedValues.material_items.filter(hasSavedBomItem),
    products,
  )
    .map((item) => ({
      ...item,
      brand: item.brand ?? "",
      model_number: item.model_number ?? "",
      specification: item.specification ?? "",
      make_specification:
        [item.brand, item.model_number, item.specification].filter(Boolean).join(" / ") ||
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
      materialSummary.summary_module_brand || "",
    summary_module_wattage:
      materialSummary.summary_module_wattage || "",
    summary_inverter_brand:
      materialSummary.summary_inverter_brand || "",
    inverter_type: preparedValues.system_type,
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

function syncBomProductUnits(
  items: QuotationMaterialItem[],
  products: Product[],
) {
  const productsById = new Map(products.map((product) => [product.id, product]));

  return items.map((item) => {
    const product = item.product_id ? productsById.get(item.product_id) : null;
    return product ? { ...item, unit: product.unit } : item;
  });
}

function emptyMaterialItem(): QuotationMaterialItem {
  return {
    inventory_item_id: "",
    product_category_id: "",
    product_id: "",
    hsn_code: "",
    description: "",
    brand: "",
    model_number: "",
    specification: "",
    make_specification: "",
    quantity: "",
    unit: "",
  };
}

function hasSavedBomItem(item: QuotationMaterialItem) {
  return Boolean(
    item.product_id ||
      (item.description.trim() &&
        [
          item.hsn_code,
          item.brand,
          item.model_number,
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

function bomCategoryLabel(
  item: QuotationMaterialItem,
  categories: ProductCategory[],
) {
  return (
    item.bom_category_name ||
    productCategoryName(categories, item.product_category_id)
  );
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

