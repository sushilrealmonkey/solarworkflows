alter table public.b2b_sales
add column if not exists billing_address text,
add column if not exists delivery_address text,
add column if not exists gst_number text;
