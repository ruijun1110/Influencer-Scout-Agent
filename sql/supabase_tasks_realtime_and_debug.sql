-- Tasks + Realtime debugging (run in Supabase SQL Editor as needed).
--
-- 1) Ensure `public.tasks` is in the Realtime publication (required for postgres_changes).
--    If you see "already member of publication", it is already enabled.
alter publication supabase_realtime add table public.tasks;

-- 2) After a stuck run, inspect the row (replace TASK_UUID):
-- select id, user_id, status, error, updated_at from public.tasks where id = 'TASK_UUID';
--
-- 3) `tasks.user_id` must match the authenticated user's id (auth.users.id / JWT `sub`)
--    or Realtime and RLS will hide updates from the client.
