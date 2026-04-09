create table if not exists public.teamflow_boards (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_teamflow_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_teamflow_boards_updated_at on public.teamflow_boards;

create trigger set_teamflow_boards_updated_at
before update on public.teamflow_boards
for each row
execute function public.set_teamflow_updated_at();

alter table public.teamflow_boards enable row level security;

drop policy if exists "teamflow public read" on public.teamflow_boards;
create policy "teamflow public read"
on public.teamflow_boards
for select
to anon, authenticated
using (true);

drop policy if exists "teamflow public insert" on public.teamflow_boards;
create policy "teamflow public insert"
on public.teamflow_boards
for insert
to anon, authenticated
with check (true);

drop policy if exists "teamflow public update" on public.teamflow_boards;
create policy "teamflow public update"
on public.teamflow_boards
for update
to anon, authenticated
using (true)
with check (true);

insert into public.teamflow_boards (id, state)
values (
  'northside-falcons',
  '{}'::jsonb
)
on conflict (id) do nothing;
