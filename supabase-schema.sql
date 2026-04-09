create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'team_role') then
    create type public.team_role as enum ('manager', 'player');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_type') then
    create type public.event_type as enum ('practice', 'game', 'tournament', 'social');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type public.event_status as enum ('scheduled', 'postponed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'availability_response') then
    create type public.availability_response as enum ('pending', 'available', 'maybe', 'unavailable');
  end if;
  if not exists (select 1 from pg_type where typname = 'checkin_status') then
    create type public.checkin_status as enum ('pending', 'on_time', 'late', 'excused', 'unexcused');
  end if;
end
$$;

create table if not exists public.teams (
  id text primary key,
  name text not null,
  allow_self_signup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams
add column if not exists allow_self_signup boolean not null default false;

create table if not exists public.team_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  username text not null,
  email text not null,
  display_name text not null,
  role public.team_role not null default 'player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_profiles_username_lower_idx
on public.team_profiles (lower(username));

create unique index if not exists team_profiles_email_lower_idx
on public.team_profiles (lower(email));

create table if not exists public.team_events (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  created_by uuid references public.team_profiles(id) on delete set null,
  type public.event_type not null,
  title text not null,
  start_at timestamptz,
  end_at timestamptz,
  meet_time timestamptz,
  opponent text,
  location text,
  address text,
  required_players integer not null default 8 check (required_players > 0),
  notes text,
  status public.event_status not null default 'scheduled',
  recurring_group_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_event_availability (
  event_id uuid not null references public.team_events(id) on delete cascade,
  user_id uuid not null references public.team_profiles(id) on delete cascade,
  response public.availability_response not null default 'pending',
  check_in public.checkin_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
before update on public.teams
for each row
execute function public.set_updated_at();

drop trigger if exists set_team_profiles_updated_at on public.team_profiles;
create trigger set_team_profiles_updated_at
before update on public.team_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_team_events_updated_at on public.team_events;
create trigger set_team_events_updated_at
before update on public.team_events
for each row
execute function public.set_updated_at();

drop trigger if exists set_team_event_availability_updated_at on public.team_event_availability;
create trigger set_team_event_availability_updated_at
before update on public.team_event_availability
for each row
execute function public.set_updated_at();

create or replace function public.current_team_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select team_id
  from public.team_profiles
  where id = auth.uid()
$$;

create or replace function public.is_team_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_profiles
    where id = auth.uid()
      and role = 'manager'
  )
$$;

create or replace function public.resolve_login_identifier(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select email
      from public.team_profiles
      where lower(username) = lower(trim(p_identifier))
      limit 1
    ),
    case
      when position('@' in trim(p_identifier)) > 0 then lower(trim(p_identifier))
      else null
    end
  )
$$;

create or replace function public.ensure_team_exists(p_team_id text, p_team_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teams (id, name)
  values (p_team_id, p_team_name)
  on conflict (id) do update
  set name = excluded.name,
      updated_at = now();
end;
$$;

create or replace function public.create_profile_for_email(
  p_email text,
  p_team_id text,
  p_username text,
  p_display_name text,
  p_role public.team_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id
  into v_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'No auth user exists for email %', p_email;
  end if;

  insert into public.team_profiles (id, team_id, username, email, display_name, role)
  values (
    v_user_id,
    p_team_id,
    lower(trim(p_username)),
    lower(trim(p_email)),
    trim(p_display_name),
    p_role
  )
  on conflict (id) do update
  set team_id = excluded.team_id,
      username = excluded.username,
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      updated_at = now();
end;
$$;

create or replace function public.sync_player_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_registration_mode text;
  v_team_id text;
  v_username text;
  v_display_name text;
  v_email text;
begin
  v_registration_mode := coalesce(new.raw_user_meta_data ->> 'registration_mode', '');
  if v_registration_mode <> 'player_self_signup' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (old.email_confirmed_at is not null or new.email_confirmed_at is null) then
    return new;
  end if;

  if new.email_confirmed_at is null then
    return new;
  end if;

  v_team_id := lower(trim(coalesce(new.raw_user_meta_data ->> 'team_id', '')));
  v_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    raise exception 'Player signup requires an email address';
  end if;

  if v_team_id = '' then
    raise exception 'Player signup is missing the team identifier';
  end if;

  if not exists (
    select 1
    from public.teams
    where id = v_team_id
      and allow_self_signup
  ) then
    raise exception 'Player self-registration is not enabled for team %', v_team_id;
  end if;

  if v_username !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usernames must be 3-30 characters and can only use lowercase letters, numbers, dots, hyphens, or underscores';
  end if;

  if char_length(v_display_name) < 2 then
    raise exception 'Display name must be at least 2 characters';
  end if;

  insert into public.team_profiles (id, team_id, username, email, display_name, role)
  values (new.id, v_team_id, v_username, v_email, v_display_name, 'player')
  on conflict (id) do nothing;

  return new;
exception
  when unique_violation then
    if exists (
      select 1
      from public.team_profiles
      where lower(username) = v_username
        and id <> new.id
    ) then
      raise exception 'Username % is already taken', v_username;
    end if;

    if exists (
      select 1
      from public.team_profiles
      where lower(email) = v_email
        and id <> new.id
    ) then
      raise exception 'An account for % already exists', v_email;
    end if;

    raise;
end;
$$;

drop trigger if exists sync_player_profile_after_auth_insert on auth.users;
create trigger sync_player_profile_after_auth_insert
after insert on auth.users
for each row
execute function public.sync_player_profile_from_auth_user();

drop trigger if exists sync_player_profile_after_auth_update on auth.users;
create trigger sync_player_profile_after_auth_update
after update of email_confirmed_at on auth.users
for each row
execute function public.sync_player_profile_from_auth_user();

create or replace function public.seed_availability_for_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_event_availability (event_id, user_id)
  select new.id, profile.id
  from public.team_profiles profile
  where profile.team_id = new.team_id
  on conflict (event_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_availability_after_event_insert on public.team_events;
create trigger seed_availability_after_event_insert
after insert on public.team_events
for each row
execute function public.seed_availability_for_event();

create or replace function public.seed_availability_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_event_availability (event_id, user_id)
  select event.id, new.id
  from public.team_events event
  where event.team_id = new.team_id
  on conflict (event_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_availability_after_profile_insert on public.team_profiles;
create trigger seed_availability_after_profile_insert
after insert on public.team_profiles
for each row
execute function public.seed_availability_for_profile();

create or replace function public.guard_availability_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_manager boolean;
begin
  v_is_manager := public.is_team_manager();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not v_is_manager then
    new.user_id := auth.uid();
    if tg_op = 'INSERT' then
      new.check_in := 'pending';
    else
      new.check_in := old.check_in;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_availability_before_insert on public.team_event_availability;
create trigger guard_availability_before_insert
before insert on public.team_event_availability
for each row
execute function public.guard_availability_write();

drop trigger if exists guard_availability_before_update on public.team_event_availability;
create trigger guard_availability_before_update
before update on public.team_event_availability
for each row
execute function public.guard_availability_write();

alter table public.teams enable row level security;
alter table public.team_profiles enable row level security;
alter table public.team_events enable row level security;
alter table public.team_event_availability enable row level security;

drop policy if exists "members read own team" on public.teams;
create policy "members read own team"
on public.teams
for select
to authenticated
using (id = public.current_team_id());

drop policy if exists "manager manage teams" on public.teams;
create policy "manager manage teams"
on public.teams
for all
to authenticated
using (public.is_team_manager() and id = public.current_team_id())
with check (public.is_team_manager() and id = public.current_team_id());

drop policy if exists "profile self or manager read" on public.team_profiles;
create policy "profile self or manager read"
on public.team_profiles
for select
to authenticated
using (
  id = auth.uid()
  or (
    public.is_team_manager()
    and team_id = public.current_team_id()
  )
);

drop policy if exists "manager manage profiles" on public.team_profiles;
create policy "manager manage profiles"
on public.team_profiles
for all
to authenticated
using (
  public.is_team_manager()
  and team_id = public.current_team_id()
)
with check (
  public.is_team_manager()
  and team_id = public.current_team_id()
);

drop policy if exists "team members read events" on public.team_events;
create policy "team members read events"
on public.team_events
for select
to authenticated
using (team_id = public.current_team_id());

drop policy if exists "manager manage events" on public.team_events;
create policy "manager manage events"
on public.team_events
for all
to authenticated
using (
  public.is_team_manager()
  and team_id = public.current_team_id()
)
with check (
  public.is_team_manager()
  and team_id = public.current_team_id()
);

drop policy if exists "player reads own availability or manager reads team" on public.team_event_availability;
create policy "player reads own availability or manager reads team"
on public.team_event_availability
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    public.is_team_manager()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
);

drop policy if exists "player writes own availability or manager writes team" on public.team_event_availability;
create policy "player writes own availability or manager writes team"
on public.team_event_availability
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
  or (
    public.is_team_manager()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
);

drop policy if exists "player updates own availability or manager updates team" on public.team_event_availability;
create policy "player updates own availability or manager updates team"
on public.team_event_availability
for update
to authenticated
using (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
  or (
    public.is_team_manager()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
)
with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
  or (
    public.is_team_manager()
    and exists (
      select 1
      from public.team_events event
      where event.id = event_id
        and event.team_id = public.current_team_id()
    )
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.teams to authenticated;
grant select on public.team_profiles to authenticated;
grant select, insert, update, delete on public.team_events to authenticated;
grant select, insert, update on public.team_event_availability to authenticated;
grant execute on function public.resolve_login_identifier(text) to anon, authenticated;

select public.ensure_team_exists('gta-marvels', 'GTA Marvels');
update public.teams
set allow_self_signup = true
where id = 'gta-marvels';

-- Example onboarding after you create manager auth users in Supabase:
-- select public.create_profile_for_email('manager@example.com', 'gta-marvels', 'manager01', 'Team Manager', 'manager');
--
-- Players can self-register through the app once email/password signup is enabled in Supabase Auth.
