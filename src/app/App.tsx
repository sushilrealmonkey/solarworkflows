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
import { ModulePlaceholderPage } from "../components/ModulePlaceholderPage";
import { TodayPage } from "../modules/assistant/TodayPage";
import { CustomersPage } from "../modules/crm/CustomersPage";
import { CustomerDetailPage } from "../modules/crm/CustomerDetailPage";
import { LeadsPage } from "../modules/crm/LeadsPage";
import { LeadDetailPage } from "../modules/crm/LeadDetailPage";
import { QuotationsPage } from "../modules/quotations/QuotationsPage";
import { QuotationDetailPage } from "../modules/quotations/QuotationDetailPage";
import { NewQuotationPage } from "../modules/quotations/NewQuotationPage";
import { RoleScopedDashboardPage, RoleScopedProjectsPage, RoleScopedSurveysPage } from "./RoleScopedModulePages";
import { PaymentsPage } from "../modules/payments/PaymentsPage";
import { PaymentDetailPage } from "../modules/payments/PaymentDetailPage";
import { B2BSalesPage } from "../modules/b2b-sales/B2BSalesPage";
import { B2BSaleDetailPage } from "../modules/b2b-sales/B2BSaleDetailPage";
import { BomTemplatesPage } from "../modules/bom-templates/BomTemplatesPage";
import { BomTemplateDetailPage } from "../modules/bom-templates/BomTemplateDetailPage";
import { CategoryMasterPage } from "../modules/product-master/CategoryMasterPage";
import { ProductMasterPage } from "../modules/product-master/ProductMasterPage";
import { ProductDetailPage } from "../modules/product-master/ProductDetailPage";
import { CatalogLibraryPage } from "../modules/catalog-library/CatalogLibraryPage";
import { InventoryPage } from "../modules/inventory/InventoryPage";
import { InventoryDetailPage } from "../modules/inventory/InventoryDetailPage";
import { InventoryOpeningStockPage } from "../modules/inventory/InventoryOpeningStockPage";
import { VendorsPage } from "../modules/vendors/VendorsPage";
import { VendorDetailPage } from "../modules/vendors/VendorDetailPage";
import { PurchasesPage } from "../modules/purchases/PurchasesPage";
import { PurchaseDetailPage } from "../modules/purchases/PurchaseDetailPage";
import { InvoicesPage } from "../modules/invoices/InvoicesPage";
import { InvoiceDetailPage } from "../modules/invoices/InvoiceDetailPage";
import { ProformaInvoicesPage } from "../modules/proforma-invoices/ProformaInvoicesPage";
import { ProformaInvoiceDetailPage } from "../modules/proforma-invoices/ProformaInvoiceDetailPage";
import { CompaniesPage } from "../modules/companies/CompaniesPage";
import { CompanyDetailPage } from "../modules/companies/CompanyDetailPage";
import { WhatsAppMessagingPage } from "../modules/whatsapp-messaging/WhatsAppMessagingPage";
import { PlatformStaffPage } from "../modules/platform-staff/PlatformStaffPage";
import {
  SettingsPage,
} from "../modules/settings/SettingsPage";
import { BillingPlansPage } from "../modules/billing/BillingPlansPage";
import { SubscriptionRoute } from "../modules/billing/SubscriptionRoute";
import { NotificationsPage } from "../modules/notifications/NotificationsPage";

export default function App() {
  return (
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
      <Route path="/onboarding" element={<WorkspaceOnboardingPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<DefaultWorkspaceRedirect />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/platform-staff" element={<PlatformStaffPage />} />
          <Route
            path="/whatsapp-messaging"
            element={<WhatsAppMessagingPage />}
          />
          <Route path="/dashboard" element={<RoleScopedDashboardPage />} />
          <Route
            path="/today"
            element={
              <SubscriptionRoute moduleKey="assistant">
                <TodayPage />
              </SubscriptionRoute>
            }
          />
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
                  "/whatsapp-messaging",
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DefaultWorkspaceRedirect() {
  const { profile } = useAuth();

  return <Navigate to={authenticatedHomePath(profile)} replace />;
}
