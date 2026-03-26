-- Allow users to read their own tasks (required for Supabase Realtime)
create policy "Users can select own tasks"
  on public.tasks
  for select
  to public
  using (user_id = auth.uid());

-- Also ensure INSERT policy exists for backend task creation
create policy "Users can insert own tasks"
  on public.tasks
  for insert
  to public
  with check (user_id = auth.uid());
