-- LumiPlay: armazenamento privado para favoritos, progresso e histórico por conta.
-- Execute no SQL Editor do projeto Supabase correto antes de ativar a sincronização.
create table if not exists public.user_library_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_library_state enable row level security;
revoke all on table public.user_library_state from anon;
grant select, insert, update, delete on table public.user_library_state to authenticated;

drop policy if exists "Users can read their own LumiPlay state" on public.user_library_state;
create policy "Users can read their own LumiPlay state"
  on public.user_library_state for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own LumiPlay state" on public.user_library_state;
create policy "Users can create their own LumiPlay state"
  on public.user_library_state for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own LumiPlay state" on public.user_library_state;
create policy "Users can update their own LumiPlay state"
  on public.user_library_state for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own LumiPlay state" on public.user_library_state;
create policy "Users can delete their own LumiPlay state"
  on public.user_library_state for delete to authenticated
  using (auth.uid() = user_id);

-- Valida a forma e limita o tamanho do estado enviado por cada conta.
-- NOT VALID evita bloquear a migração por dados antigos; novas gravações já são verificadas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_library_state_object_check' and conrelid = 'public.user_library_state'::regclass) then
    alter table public.user_library_state
      add constraint user_library_state_object_check
      check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1048576) not valid;
  end if;
end $$;
