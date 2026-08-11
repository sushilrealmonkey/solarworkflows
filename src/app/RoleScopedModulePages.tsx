import { useAuth } from "./AuthProvider";
import { ProjectsPage } from "../modules/projects/ProjectsPage";
import { ProjectDetailPage } from "../modules/projects/ProjectDetailPage";
import { FieldProjectDetailPage, FieldProjectsPage } from "../modules/projects/FieldProjects";
import { RestrictedProjectDetailPage, RestrictedProjectsPage } from "../modules/projects/RestrictedProjectSummaries";
import { SiteSurveysPage } from "../modules/site-surveys/SiteSurveysPage";
import { SiteSurveyDetailPage } from "../modules/site-surveys/SiteSurveyDetailPage";
import { FieldSiteSurveyDetailPage, FieldSiteSurveysPage } from "../modules/site-surveys/FieldSiteSurveys";
import { RestrictedSurveyDetailPage, RestrictedSurveysPage } from "../modules/site-surveys/RestrictedSurveySummaries";
import { DashboardPage } from "../modules/dashboard/DashboardPage";
import { FieldDashboardPage } from "../modules/dashboard/FieldDashboardPage";

export function RoleScopedDashboardPage() {
  const { roleKeys } = useAuth();
  const fieldOnly = roleKeys.includes("field_staff")
    && !roleKeys.some((role) => role !== "field_staff");
  return fieldOnly ? <FieldDashboardPage /> : <DashboardPage />;
}

export function RoleScopedProjectsPage({ detail = false }: { detail?: boolean }) {
  const { roleKeys } = useAuth();
  if (roleKeys.includes("admin") || roleKeys.includes("backend_team")) return detail ? <ProjectDetailPage /> : <ProjectsPage />;
  if (roleKeys.includes("sales_team") || roleKeys.includes("accounts")) return detail ? <RestrictedProjectDetailPage /> : <RestrictedProjectsPage />;
  if (roleKeys.includes("field_staff")) return detail ? <FieldProjectDetailPage /> : <FieldProjectsPage />;
  return detail ? <ProjectDetailPage /> : <ProjectsPage />;
}

export function RoleScopedSurveysPage({ detail = false }: { detail?: boolean }) {
  const { roleKeys } = useAuth();
  if (roleKeys.includes("admin") || roleKeys.includes("backend_team")) return detail ? <SiteSurveyDetailPage /> : <SiteSurveysPage />;
  if (roleKeys.includes("sales_team")) return detail ? <RestrictedSurveyDetailPage /> : <RestrictedSurveysPage />;
  if (roleKeys.includes("field_staff")) return detail ? <FieldSiteSurveyDetailPage /> : <FieldSiteSurveysPage />;
  return detail ? <SiteSurveyDetailPage /> : <SiteSurveysPage />;
}
