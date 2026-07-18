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
import { DashboardPage } from "../modules/dashboard/DashboardPage";
import { TodayPage } from "../modules/assistant/TodayPage";
import { CustomersPage } from "../modules/crm/CustomersPage";
import { CustomerDetailPage } from "../modules/crm/CustomerDetailPage";
import { LeadsPage } from "../modules/crm/LeadsPage";
import { LeadDetailPage } from "../modules/crm/LeadDetailPage";
import { SiteSurveysPage } from "../modules/site-surveys/SiteSurveysPage";
import { SiteSurveyDetailPage } from "../modules/site-surveys/SiteSurveyDetailPage";
import { QuotationsPage } from "../modules/quotations/QuotationsPage";
import { QuotationDetailPage } from "../modules/quotations/QuotationDetailPage";
import { NewQuotationPage } from "../modules/quotations/NewQuotationPage";
import { ProjectsPage } from "../modules/projects/ProjectsPage";
import { ProjectDetailPage } from "../modules/projects/ProjectDetailPage";
import { PaymentsPage } from "../modules/payments/PaymentsPage";
import { PaymentDetailPage } from "../modules/payments/PaymentDetailPage";
import { B2BSalesPage } from "../modules/b2b-sales/B2BSalesPage";
import { B2BSaleDetailPage } from "../modules/b2b-sales/B2BSaleDetailPage";
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
import {
  SettingsPage,
} from "../modules/settings/SettingsPage";

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
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/today" element={<TodayPage />} />
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
            element={<CustomersPage segment="b2b_direct" />}
          />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/site-surveys" element={<SiteSurveysPage />} />
          <Route path="/site-surveys/:id" element={<SiteSurveyDetailPage />} />
          <Route path="/quotations" element={<QuotationsPage />} />
          <Route path="/quotations/new" element={<NewQuotationPage />} />
          <Route path="/quotations/:id/edit" element={<NewQuotationPage />} />
          <Route path="/quotations/:id" element={<QuotationDetailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payments/:id" element={<PaymentDetailPage />} />
          <Route path="/b2b-sales" element={<B2BSalesPage />} />
          <Route path="/b2b-sales/:id" element={<B2BSaleDetailPage />} />
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
            element={<ProductMasterPage />}
          />
          <Route
            path="/products-materials/categories"
            element={<CategoryMasterPage />}
          />
          <Route
            path="/products-materials/catalog-library"
            element={<CatalogLibraryPage />}
          />
          <Route
            path="/product-master/:id"
            element={<ProductDetailPage />}
          />
          <Route
            path="/products-materials/products/:id"
            element={<ProductDetailPage />}
          />
          <Route path="/products-materials/:id" element={<ProductDetailPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route
            path="/inventory/opening-stock"
            element={<InventoryOpeningStockPage />}
          />
          <Route path="/inventory/:id" element={<InventoryDetailPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/vendors/:id" element={<VendorDetailPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
          <Route path="/material-receive" element={<Navigate to="/purchases" replace />} />
          <Route path="/proforma-invoices" element={<ProformaInvoicesPage />} />
          <Route path="/proforma-invoices/:id" element={<ProformaInvoiceDetailPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/reports" element={<Navigate to="/dashboard" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/*" element={<Navigate to="/settings" replace />} />
          {routes
            .filter(
              (route) =>
                ![
                  "/dashboard",
                  "/companies",
                  "/companies/:id",
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
