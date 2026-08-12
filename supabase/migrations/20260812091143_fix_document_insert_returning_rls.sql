-- PostgREST returns inserted document rows when the web client uses
-- .insert(...).select(). The previous SELECT policy delegated to a helper that
-- re-queried documents by id; that row is not visible to the nested query until
-- the INSERT statement completes, so INSERT ... RETURNING failed even when the
-- INSERT policy passed. Authorize directly from the candidate row fields while
-- preserving company, organization, role-scope, and related-record checks.

create or replace function private.can_access_document_row(
  target_organization_id uuid,
  target_company_id uuid,
  target_customer_id uuid,
  target_lead_id uuid,
  target_project_id uuid,
  target_quotation_id uuid,
  target_invoice_id uuid,
  target_proforma_invoice_id uuid,
  target_purchase_order_id uuid,
  target_b2b_sale_id uuid,
  target_document_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select target_organization_id = public.current_user_organization_id()
    and target_company_id = public.get_current_user_company_id()
    and (
      private.has_record_scope('documents','company')
      or (private.has_record_scope('documents','related_operations') and (
        (
          private.has_role('sales_team')
          and target_invoice_id is null
          and target_proforma_invoice_id is null
          and target_purchase_order_id is null
          and target_document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
          and (
            private.sales_owns_customer(target_customer_id)
            or private.sales_owns_lead(target_lead_id)
            or private.sales_owns_project(target_project_id)
            or exists (
              select 1 from public.quotations q
              where q.id = target_quotation_id
                and q.assigned_to = private.current_profile_id()
            )
          )
        )
        or (
          private.has_role('backend_team')
          and target_invoice_id is null
          and target_proforma_invoice_id is null
          and target_document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
          and (
            target_project_id is not null
            or target_quotation_id is not null
            or target_purchase_order_id is not null
            or target_document_type in ('site_photo','installation_photo')
          )
        )
      ))
      or (private.has_record_scope('documents','related_finance') and (
        target_invoice_id is not null
        or target_proforma_invoice_id is not null
        or target_purchase_order_id is not null
        or target_b2b_sale_id is not null
        or target_document_type in ('invoice_pdf','payment_receipt','bank_loan_document')
      ))
    );
$$;

create or replace function private.can_access_document_record(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_access_document_row(
    d.organization_id,
    d.company_id,
    d.customer_id,
    d.lead_id,
    d.project_id,
    d.quotation_id,
    d.invoice_id,
    d.proforma_invoice_id,
    d.purchase_order_id,
    d.b2b_sale_id,
    d.document_type
  )
  from public.documents d
  where d.id = target_document_id;
$$;

drop policy if exists "Scoped document reads" on public.documents;
create policy "Scoped document reads"
on public.documents
for select
to authenticated
using (
  public.is_super_admin()
  or (
    public.user_has_permission('documents','view')
    and private.can_access_document_row(
      organization_id,
      company_id,
      customer_id,
      lead_id,
      project_id,
      quotation_id,
      invoice_id,
      proforma_invoice_id,
      purchase_order_id,
      b2b_sale_id,
      document_type
    )
  )
);
