import { PageHeader } from "./PageHeader";
import { PlaceholderPanel } from "./PlaceholderPanel";

type ModulePlaceholderPageProps = {
  title: string;
  description: string;
};

export function ModulePlaceholderPage({
  title,
  description,
}: ModulePlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <PlaceholderPanel title="Module coming next">
        This area is ready in the protected app shell. Detailed workflows, forms,
        and data views will be added in the next module build steps.
      </PlaceholderPanel>
    </div>
  );
}
