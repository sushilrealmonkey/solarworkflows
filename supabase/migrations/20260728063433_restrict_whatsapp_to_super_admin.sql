-- WhatsApp prospect messaging is an internal Bizlee capability. Tenant users
-- must not be able to read phone-number mappings, conversations, or messages.

drop policy if exists "Tenant members can view WhatsApp phone numbers"
on public.whatsapp_phone_numbers;

drop policy if exists "Tenant members can view WhatsApp conversations"
on public.whatsapp_conversations;

drop policy if exists "Tenant members can view WhatsApp messages"
on public.whatsapp_messages;

create policy "Super admins can view WhatsApp phone numbers"
on public.whatsapp_phone_numbers
for select
to authenticated
using ((select public.is_super_admin()));

create policy "Super admins can view WhatsApp conversations"
on public.whatsapp_conversations
for select
to authenticated
using ((select public.is_super_admin()));

create policy "Super admins can view WhatsApp messages"
on public.whatsapp_messages
for select
to authenticated
using ((select public.is_super_admin()));
