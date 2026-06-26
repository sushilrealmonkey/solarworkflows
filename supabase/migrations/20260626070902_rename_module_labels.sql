update public.modules
set module_name = case module_key
  when 'leads' then 'Enquiries'
  when 'customers' then 'Customers'
  when 'b2b_sales' then 'Sales Orders'
  when 'vendors' then 'Suppliers'
  when 'purchases' then 'Purchase Orders'
  when 'invoices' then 'Tax Invoices'
  else module_name
end
where module_key in (
  'leads',
  'customers',
  'b2b_sales',
  'vendors',
  'purchases',
  'invoices'
);
