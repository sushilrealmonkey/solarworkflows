import { PageHeader } from "../../components/PageHeader";
import { PlaceholderPanel } from "../../components/PlaceholderPanel";

export function CompaniesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Placeholder for client company management across the multi-tenant platform."
      />
      <PlaceholderPanel title="Company Directory">
        Company records and tenant administration will be implemented in a later
        task.
      </PlaceholderPanel>
    </div>
  );
}
