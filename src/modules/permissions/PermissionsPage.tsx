import { PageHeader } from "../../components/PageHeader";
import { PlaceholderPanel } from "../../components/PlaceholderPanel";

export function PermissionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        description="Placeholder for role and permission management within each company."
      />
      <PlaceholderPanel title="Access Control">
        Permission rules and role assignments will be designed after the tenant
        model is defined.
      </PlaceholderPanel>
    </div>
  );
}
