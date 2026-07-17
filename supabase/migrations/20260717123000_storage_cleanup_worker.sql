-- Service-only claim/complete API for idempotent Storage cleanup.

create or replace function public.claim_storage_cleanup(batch_size integer default 25)
returns setof public.storage_cleanup_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  return query
  with claimed as (
    select id
    from public.storage_cleanup_queue
    where status in ('pending', 'failed') and attempts < 10
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 25), 100))
  )
  update public.storage_cleanup_queue queue
  set status = 'processing', attempts = attempts + 1, last_error = null
  from claimed
  where queue.id = claimed.id
  returning queue.*;
end;
$$;

create or replace function public.complete_storage_cleanup(queue_id uuid, failure_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  queue_record public.storage_cleanup_queue%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into queue_record from public.storage_cleanup_queue where id = queue_id for update;
  if not found then return; end if;

  if nullif(btrim(coalesce(failure_message, '')), '') is not null then
    update public.storage_cleanup_queue set status = 'failed', last_error = left(failure_message, 2000) where id = queue_id;
    return;
  end if;

  if queue_record.delete_document_metadata and queue_record.document_id is not null then
    perform set_config('app.lifecycle_delete', 'on', true);
    perform set_config('app.lifecycle_transition', 'on', true);
    delete from public.documents where id = queue_record.document_id;
  end if;
  update public.storage_cleanup_queue set status = 'completed', processed_at = now(), last_error = null where id = queue_id;
end;
$$;

revoke execute on function public.claim_storage_cleanup(integer) from public, anon, authenticated;
revoke execute on function public.complete_storage_cleanup(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer) to service_role;
grant execute on function public.complete_storage_cleanup(uuid, text) to service_role;

notify pgrst, 'reload schema';

