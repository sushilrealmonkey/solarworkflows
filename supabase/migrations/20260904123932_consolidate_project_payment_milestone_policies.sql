-- Keep one permissive policy per action. The former separate super-admin and
-- project-user policies were logically correct, but evaluated twice per row.

drop policy "Super admins can manage project payment milestones"
on public.project_payment_milestones;
drop policy "Project users can view payment milestones"
on public.project_payment_milestones;
drop policy "Project users can create payment milestones"
on public.project_payment_milestones;
drop policy "Project users can update payment milestones"
on public.project_payment_milestones;
drop policy "Project users can delete payment milestones"
on public.project_payment_milestones;

create policy "Users can view project payment milestones"
on public.project_payment_milestones for select to authenticated
using (
  (select public.is_super_admin())
  or (
    company_id = (select public.current_user_company_id())
    and exists (
      select 1
      from public.projects
      where projects.id = project_payment_milestones.project_id
    )
  )
);

create policy "Users can create project payment milestones"
on public.project_payment_milestones for insert to authenticated
with check (
  (select public.is_super_admin())
  or (
    company_id = (select public.current_user_company_id())
    and (select public.user_has_permission('projects', 'update'))
    and exists (
      select 1
      from public.projects
      where projects.id = project_payment_milestones.project_id
    )
  )
);

create policy "Users can update project payment milestones"
on public.project_payment_milestones for update to authenticated
using (
  (select public.is_super_admin())
  or (
    company_id = (select public.current_user_company_id())
    and (select public.user_has_permission('projects', 'update'))
    and exists (
      select 1
      from public.projects
      where projects.id = project_payment_milestones.project_id
    )
  )
)
with check (
  (select public.is_super_admin())
  or (
    company_id = (select public.current_user_company_id())
    and (select public.user_has_permission('projects', 'update'))
    and exists (
      select 1
      from public.projects
      where projects.id = project_payment_milestones.project_id
    )
  )
);

create policy "Users can delete project payment milestones"
on public.project_payment_milestones for delete to authenticated
using (
  (select public.is_super_admin())
  or (
    company_id = (select public.current_user_company_id())
    and (select public.user_has_permission('projects', 'update'))
    and exists (
      select 1
      from public.projects
      where projects.id = project_payment_milestones.project_id
    )
  )
);
