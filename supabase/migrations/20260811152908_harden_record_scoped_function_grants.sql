-- Public functions receive EXECUTE for PUBLIC by default. Keep the role and
-- settings APIs callable only by the identities that need them.

revoke execute on function public.seed_epc_standard_roles(uuid)
  from PUBLIC, anon, authenticated;
grant execute on function public.seed_epc_standard_roles(uuid)
  to service_role;

revoke execute on function public.user_has_permission(text, text)
  from PUBLIC, anon;
grant execute on function public.user_has_permission(text, text)
  to authenticated, service_role;

revoke execute on function public.get_settings_roles()
  from PUBLIC, anon;
grant execute on function public.get_settings_roles()
  to authenticated, service_role;

revoke execute on function public.create_settings_staff(text, text, text, uuid, text)
  from PUBLIC, anon;
grant execute on function public.create_settings_staff(text, text, text, uuid, text)
  to authenticated, service_role;

revoke execute on function public.update_settings_staff(uuid, text, text, text, uuid, text)
  from PUBLIC, anon;
grant execute on function public.update_settings_staff(uuid, text, text, text, uuid, text)
  to authenticated, service_role;

-- This trigger function was surfaced by the post-deployment security advisor.
-- Fix its resolution path without changing the evidence immutability behavior.
alter function public.protect_document_evidence() set search_path = public;
revoke execute on function public.protect_document_evidence()
  from PUBLIC, anon, authenticated;
