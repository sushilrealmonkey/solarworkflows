import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "./AuthProvider";
import { authenticatedHomePath } from "./redirects";
import { DashboardLayout } from "../layouts/DashboardLayout";
import { routes } from "./routes";
import { LoginPage } from "../modules/auth/LoginPage";
import { LoginDarkPage, LoginMobilePage } from "../modules/auth/LoginDarkPage";
import { LoginDesignsPage } from "../modules/auth/LoginDesignsPage";
import { CreatePasswordPage } from "../modules/auth/CreatePasswordPage";
import { ForgotPasswordPage } from "../modules/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../modules/auth/ResetPasswordPage";
import { SignupPage } from "../modules/auth/SignupPage";
import { AuthCallbackPage } from "../modules/auth/AuthCallbackPage";
import { WorkspaceOnboardingPage } from "../modules/auth/WorkspaceOnboardingPage";
import { OnboardingGate } from "../modules/onboarding/OnboardingGate";
import { OnboardingWelcomePage } from "../modules/onboarding/OnboardingWelcomePage";
import { OnboardingCompanyPage } from "../modules/onboarding/OnboardingCompanyPage";
import { OnboardingProductsPage } from "../modules/onboarding/OnboardingProductsPage";
import { OnboardingProductEntryPage } from "../modules/onboarding/OnboardingProductEntryPage";
import { OnboardingProductImportPage } from "../modules/onboarding/OnboardingProductImportPage";
import { OnboardingProductBankPage } from "../modules/onboarding/OnboardingProductBankPage";
import { OnboardingTeamPage } from "../modules/onboarding/OnboardingTeamPage";
import { OnboardingReadyPage } from "../modules/onboarding/OnboardingReadyPage";
import { OnboardingPaymentPage } from "../modules/onboarding/OnboardingPaymentPage";
import { ModulePlaceholderPage } from "../components/ModulePlaceholderPage";
import { PortalActivityTracker } from "../modules/trial-outreach/PortalActivityTracker";
import { SubscriptionRoute } from "../modules/billing/SubscriptionRoute";
import { PageLoader } from "../components/PageLoader";

const TodayPage = lazy(() => import("../modules/assistant/TodayPage").then((module) => ({ default: module.TodayPage })));
const CustomersPage = lazy(() => import("../modules/crm/CustomersPage").then((module) => ({ default: module.CustomersPage })));
const CustomerDetailPage = lazy(() => import("../modules/crm/CustomerDetailPage").then((module) => ({ default: module.CustomerDetailPage })));
const LeadsPage = lazy(() => import("../modules/crm/LeadsPage").then((module) => ({ default: module.LeadsPage })));
const LeadDetailPage = lazy(() => import("../modules/crm/LeadDetailPage").then((module) => ({ default: module.LeadDetailPage })));
const QuotationsPage = lazy(() => import("../modules/quotations/QuotationsPage").then((module) => ({ default: module.QuotationsPage })));
const QuotationDetailPage = lazy(() => import("../modules/quotations/QuotationDetailPage").then((module) => ({ default: module.QuotationDetailPage })));
const NewQuotationPage = lazy(() => import("../modules/quotations/NewQuotationPage").then((module) => ({ default: module.NewQuotationPage })));
const RoleScopedDashboardPage = lazy(() => import("./RoleScopedModulePages").then((module) => ({ default: module.RoleScopedDashboardPage })));
const RoleScopedProjectsPage = lazy(() => import("./RoleScopedModulePages").then((module) => ({ default: module.RoleScopedProjectsPage })));
const RoleScopedSurveysPage = lazy(() => import("./RoleScopedModulePages").then((module) => ({ default: module.RoleScopedSurveysPage })));
const PaymentsPage = lazy(() => import("../modules/payments/PaymentsPage").then((module) => ({ default: module.PaymentsPage })));
const PaymentDetailPage = lazy(() => import("../modules/payments/PaymentDetailPage").then((module) => ({ default: module.PaymentDetailPage })));
const B2BSalesPage = lazy(() => import("../modules/b2b-sales/B2BSalesPage").then((module) => ({ default: module.B2BSalesPage })));
const B2BSaleDetailPage = lazy(() => import("../modules/b2b-sales/B2BSaleDetailPage").then((module) => ({ default: module.B2BSaleDetailPage })));
const BomTemplatesPage = lazy(() => import("../modules/bom-templates/BomTemplatesPage").then((module) => ({ default: module.BomTemplatesPage })));
const BomTemplateDetailPage = lazy(() => import("../modules/bom-templates/BomTemplateDetailPage").then((module) => ({ default: module.BomTemplateDetailPage })));
const CategoryMasterPage = lazy(() => import("../modules/product-master/CategoryMasterPage").then((module) => ({ default: module.CategoryMasterPage })));
const ProductMasterPage = lazy(() => import("../modules/product-master/ProductMasterPage").then((module) => ({ default: module.ProductMasterPage })));
const ProductDetailPage = lazy(() => import("../modules/product-master/ProductDetailPage").then((module) => ({ default: module.ProductDetailPage })));
const CatalogLibraryPage = lazy(() => import("../modules/catalog-library/CatalogLibraryPage").then((module) => ({ default: module.CatalogLibraryPage })));
const ProductBankPage = lazy(() => import("../modules/product-bank/ProductBankPage").then((module) => ({ default: module.ProductBankPage })));
const InventoryPage = lazy(() => import("../modules/inventory/InventoryPage").then((module) => ({ default: module.InventoryPage })));
const InventoryDetailPage = lazy(() => import("../modules/inventory/InventoryDetailPage").then((module) => ({ default: module.InventoryDetailPage })));
const InventoryOpeningStockPage = lazy(() => import("../modules/inventory/InventoryOpeningStockPage").then((module) => ({ default: module.InventoryOpeningStockPage })));
const VendorsPage = lazy(() => import("../modules/vendors/VendorsPage").then((module) => ({ default: module.VendorsPage })));
const VendorDetailPage = lazy(() => import("../modules/vendors/VendorDetailPage").then((module) => ({ default: module.VendorDetailPage })));
const SuppliersPage = lazy(() => import("../modules/suppliers/SuppliersPage").then((module) => ({ default: module.SuppliersPage })));
const SupplierDetailPage = lazy(() => import("../modules/suppliers/SupplierDetailPage").then((module) => ({ default: module.SupplierDetailPage })));
const ExpensesPage = lazy(() => import("../modules/expenses/ExpensesPage").then((module) => ({ default: module.ExpensesPage })));
const PurchasesPage = lazy(() => import("../modules/purchases/PurchasesPage").then((module) => ({ default: module.PurchasesPage })));
const PurchaseDetailPage = lazy(() => import("../modules/purchases/PurchaseDetailPage").then((module) => ({ default: module.PurchaseDetailPage })));
const InvoicesPage = lazy(() => import("../modules/invoices/InvoicesPage").then((module) => ({ default: module.InvoicesPage })));
const InvoiceDetailPage = lazy(() => import("../modules/invoices/InvoiceDetailPage").then((module) => ({ default: module.InvoiceDetailPage })));
const ProformaInvoicesPage = lazy(() => import("../modules/proforma-invoices/ProformaInvoicesPage").then((module) => ({ default: module.ProformaInvoicesPage })));
const ProformaInvoiceDetailPage = lazy(() => import("../modules/proforma-invoices/ProformaInvoiceDetailPage").then((module) => ({ default: module.ProformaInvoiceDetailPage })));
const CompaniesPage = lazy(() => import("../modules/companies/CompaniesPage").then((module) => ({ default: module.CompaniesPage })));
const CompanyDetailPage = lazy(() => import("../modules/companies/CompanyDetailPage").then((module) => ({ default: module.CompanyDetailPage })));
const DemoBookingsPage = lazy(() => import("../modules/demo-bookings/DemoBookingsPage").then((module) => ({ default: module.DemoBookingsPage })));
const DemoBookingDetailPage = lazy(() => import("../modules/demo-bookings/DemoBookingDetailPage").then((module) => ({ default: module.DemoBookingDetailPage })));
const WhatsAppMessagingPage = lazy(() => import("../modules/whatsapp-messaging/WhatsAppMessagingPage").then((module) => ({ default: module.WhatsAppMessagingPage })));
const TrialOutreachPage = lazy(() => import("../modules/trial-outreach/TrialOutreachPage").then((module) => ({ default: module.TrialOutreachPage })));
const PlatformStaffPage = lazy(() => import("../modules/platform-staff/PlatformStaffPage").then((module) => ({ default: module.PlatformStaffPage })));
const SettingsPage = lazy(() => import("../modules/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const BillingPlansPage = lazy(() => import("../modules/billing/BillingPlansPage").then((module) => ({ default: module.BillingPlansPage })));
const NotificationsPage = lazy(() => import("../modules/notifications/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));

export default function App() {
  return (
    <>
      <PortalActivityTracker />
      <Suspense
        fallback={
          <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
            <PageLoader className="w-full max-w-lg" label="Loading page…" />
          </main>
        }
      >
        <Routes>
      <Route path="/login" element={<LoginDarkPage />} />
      <Route path="/login-light" element={<LoginPage />} />
      <Route path="/login-dark" element={<LoginDarkPage />} />
      <Route path="/login-mobile" element={<LoginMobilePage />} />
      <Route path="/login-designs" element={<LoginDesignsPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/create-password" element={<CreatePasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<OnboardingGate />}>
        <Route path="/workspace-setup" element={<WorkspaceOnboardingPage />} />
        <Route path="/onboarding" element={<OnboardingWelcomePage />} />
        <Route
          path="/onboarding/company"
          element={<OnboardingCompanyPage />}
        />
        <Route
          path="/onboarding/products"
          element={<OnboardingProductsPage />}
        />
        <Route
          path="/onboarding/products/add"
          element={<OnboardingProductEntryPage />}
        />
        <Route
          path="/onboarding/products/import"
          element={<OnboardingProductImportPage />}
        />
        <Route
          path="/onboarding/products/bank"
          element={<OnboardingProductBankPage />}
        />
        <Route
          path="/onboarding/team"
          element={<OnboardingTeamPage />}
        />
        <Route
          path="/onboarding/ready"
          element={<OnboardingReadyPage />}
        />
        <Route
          path="/onboarding/payment"
          element={<OnboardingPaymentPage />}
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
          <Route path="/" element={<DefaultWorkspaceRedirect />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/demo-bookings" element={<DemoBookingsPage />} />
          <Route path="/demo-bookings/:id" element={<DemoBookingDetailPage />} />
          <Route path="/platform-staff" element={<PlatformStaffPage />} />
          <Route
            path="/whatsapp-messaging"
            element={<WhatsAppMessagingPage />}
          />
          <Route path="/trial-outreach" element={<TrialOutreachPage />} />
          <Route path="/dashboard" element={<RoleScopedDashboardPage />} />
          <Route
            path="/bizlee-ai"
            element={
              <SubscriptionRoute moduleKey="assistant">
                <TodayPage />
              </SubscriptionRoute>
            }
          />
          <Route path="/today" element={<Navigate to="/bizlee-ai" replace />} />
          <Route
            path="/customers"
            element={<Navigate to="/customers/project-based" replace />}
          />
          <Route
            path="/customers/project-based"
            element={<CustomersPage segment="project_based" />}
          />
          <Route
            path="/customers/b2b-direct"
            element={<SubscriptionRoute moduleKey="b2b_sales"><CustomersPage segment="b2b_direct" /></SubscriptionRoute>}
          />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/site-surveys" element={<RoleScopedSurveysPage />} />
          <Route path="/site-surveys/:id" element={<RoleScopedSurveysPage detail />} />
          <Route path="/quotations" element={<QuotationsPage />} />
          <Route path="/quotations/new" element={<NewQuotationPage />} />
          <Route path="/quotations/:id/edit" element={<NewQuotationPage />} />
          <Route path="/quotations/:id" element={<QuotationDetailPage />} />
          <Route path="/projects" element={<RoleScopedProjectsPage />} />
          <Route path="/projects/:id" element={<RoleScopedProjectsPage detail />} />
          <Route path="/payments" element={<SubscriptionRoute moduleKey="payments"><PaymentsPage /></SubscriptionRoute>} />
          <Route path="/payments/:id" element={<SubscriptionRoute moduleKey="payments"><PaymentDetailPage /></SubscriptionRoute>} />
          <Route path="/b2b-sales" element={<SubscriptionRoute moduleKey="b2b_sales"><B2BSalesPage /></SubscriptionRoute>} />
          <Route path="/b2b-sales/:id" element={<SubscriptionRoute moduleKey="b2b_sales"><B2BSaleDetailPage /></SubscriptionRoute>} />
          <Route
            path="/product-master"
            element={<Navigate to="/products-materials/products" replace />}
          />
          <Route
            path="/products-materials"
            element={<Navigate to="/products-materials/products" replace />}
          />
          <Route
            path="/products-materials/products"
            element={<SubscriptionRoute moduleKey="product_master"><ProductMasterPage /></SubscriptionRoute>}
          />
          <Route
            path="/products-materials/categories"
            element={<SubscriptionRoute moduleKey="product_master"><CategoryMasterPage /></SubscriptionRoute>}
          />
          <Route
            path="/products-materials/product-bank"
            element={<SubscriptionRoute moduleKey="product_master"><ProductBankPage /></SubscriptionRoute>}
          />
          <Route
            path="/products-materials/catalog-library"
            element={<CatalogLibraryPage />}
          />
          <Route
            path="/product-master/:id"
            element={<SubscriptionRoute moduleKey="product_master"><ProductDetailPage /></SubscriptionRoute>}
          />
          <Route
            path="/products-materials/products/:id"
            element={<SubscriptionRoute moduleKey="product_master"><ProductDetailPage /></SubscriptionRoute>}
          />
          <Route path="/products-materials/:id" element={<SubscriptionRoute moduleKey="product_master"><ProductDetailPage /></SubscriptionRoute>} />
          <Route path="/setup/bom-templates" element={<SubscriptionRoute moduleKey="product_master"><BomTemplatesPage /></SubscriptionRoute>} />
          <Route path="/setup/bom-templates/:id" element={<SubscriptionRoute moduleKey="product_master"><BomTemplateDetailPage /></SubscriptionRoute>} />
          <Route path="/inventory" element={<SubscriptionRoute moduleKey="inventory"><InventoryPage /></SubscriptionRoute>} />
          <Route
            path="/inventory/opening-stock"
            element={<SubscriptionRoute moduleKey="inventory"><InventoryOpeningStockPage /></SubscriptionRoute>}
          />
          <Route path="/inventory/:id" element={<SubscriptionRoute moduleKey="inventory"><InventoryDetailPage /></SubscriptionRoute>} />
          <Route path="/vendors" element={<SubscriptionRoute moduleKey="vendors"><VendorsPage /></SubscriptionRoute>} />
          <Route path="/vendors/:id" element={<SubscriptionRoute moduleKey="vendors"><VendorDetailPage /></SubscriptionRoute>} />
          <Route path="/suppliers" element={<SubscriptionRoute moduleKey="vendors"><SuppliersPage /></SubscriptionRoute>} />
          <Route path="/suppliers/:id" element={<SubscriptionRoute moduleKey="vendors"><SupplierDetailPage /></SubscriptionRoute>} />
          <Route path="/expenses" element={<SubscriptionRoute moduleKey="expenses"><ExpensesPage /></SubscriptionRoute>} />
          <Route path="/purchases" element={<SubscriptionRoute moduleKey="purchases"><PurchasesPage /></SubscriptionRoute>} />
          <Route path="/purchases/:id" element={<SubscriptionRoute moduleKey="purchases"><PurchaseDetailPage /></SubscriptionRoute>} />
          <Route path="/material-receive" element={<Navigate to="/purchases" replace />} />
          <Route path="/proforma-invoices" element={<SubscriptionRoute moduleKey="invoices"><ProformaInvoicesPage /></SubscriptionRoute>} />
          <Route path="/proforma-invoices/:id" element={<SubscriptionRoute moduleKey="invoices"><ProformaInvoiceDetailPage /></SubscriptionRoute>} />
          <Route path="/invoices" element={<SubscriptionRoute moduleKey="invoices"><InvoicesPage /></SubscriptionRoute>} />
          <Route path="/invoices/:id" element={<SubscriptionRoute moduleKey="invoices"><InvoiceDetailPage /></SubscriptionRoute>} />
          <Route path="/reports" element={<Navigate to="/dashboard" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/billing/plans" element={<BillingPlansPage />} />
          <Route path="/settings/*" element={<Navigate to="/settings" replace />} />
          {routes
            .filter(
              (route) =>
                ![
                  "/dashboard",
                  "/companies",
                  "/companies/:id",
                  "/demo-bookings",
                  "/whatsapp-messaging",
                  "/trial-outreach",
                  "/customers/project-based",
                  "/customers/b2b-direct",
                  "/leads",
                  "/site-surveys",
                  "/quotations",
                  "/projects",
                  "/payments",
                  "/b2b-sales",
                  "/products-materials/products",
                  "/products-materials/categories",
                  "/products-materials/catalog-library",
                  "/inventory",
                  "/vendors",
                  "/suppliers",
                  "/expenses",
                  "/purchases",
                  "/material-receive",
                  "/proforma-invoices",
                  "/invoices",
                  "/reports",
                  "/settings",
                  "/billing/plans",
                ].includes(route.path),
            )
            .map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={
                  <ModulePlaceholderPage
                    title={route.label}
                    description={route.description}
                  />
                }
              />
            ))}
        </Route>
      </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function DefaultWorkspaceRedirect() {
  const { profile } = useAuth();

  return <Navigate to={authenticatedHomePath(profile)} replace />;
}
