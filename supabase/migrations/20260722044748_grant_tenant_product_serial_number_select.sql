-- Product detail queries include the tenant-scoped serial number introduced by
-- 20260718104043. The product table otherwise uses column-level SELECT grants
-- so pricing fields remain hidden from authenticated clients.

grant select (serial_number) on public.products to authenticated;

notify pgrst, 'reload schema';
