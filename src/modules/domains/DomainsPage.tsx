import { PageHeader } from "../../components/PageHeader";
import { PlaceholderPanel } from "../../components/PlaceholderPanel";

export function DomainsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="Placeholder for company subdomains and custom domain configuration."
      />
      <PlaceholderPanel title="Domain Routing">
        Domain verification and routing rules will be connected in a future
        backend task.
      </PlaceholderPanel>
    </div>
  );
}
