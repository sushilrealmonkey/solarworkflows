import { PageHeader } from "../../components/PageHeader";
import { PlaceholderPanel } from "../../components/PlaceholderPanel";

export function UsersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Placeholder for tenant users, invitations, and account management."
      />
      <PlaceholderPanel title="User Management">
        Supabase authentication and user lifecycle flows are not implemented yet.
      </PlaceholderPanel>
    </div>
  );
}
