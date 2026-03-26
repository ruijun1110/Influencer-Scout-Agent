-- Applied via Supabase (tasks.update returned 0 rows: RLS had no UPDATE policy).
-- Recreate on new projects if needed.

create policy "Users can update own tasks"
  on public.tasks
  for update
  to public
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
