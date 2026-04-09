-- Seed manager and player profiles for the TeamFlow app.
--
-- Important:
-- Supabase's supported way to create auth users with passwords is via
-- Authentication -> Users in the dashboard or the server-side Admin API.
-- This SQL file links those auth users to the app's team/role tables.
-- In the current app flow, players can also self-register through the UI.
-- This file is mainly for pre-seeded demo accounts and manager setup.
--
-- 1. First create these auth users in Supabase Authentication -> Users:
--    - manager@gta-marvels.com
--    - player01@gta-marvels.com
--    - player02@gta-marvels.com
--    - player03@gta-marvels.com
-- 2. Set their passwords there.
-- 3. Then run this file in SQL Editor.

begin;

select public.ensure_team_exists('gta-marvels', 'GTA Marvels');

select public.create_profile_for_email(
  'manager@gta-marvels.com',
  'gta-marvels',
  'manager01',
  'Team Manager',
  'manager'
);

select public.create_profile_for_email(
  'player01@gta-marvels.com',
  'gta-marvels',
  'player01',
  'Player One',
  'player'
);

select public.create_profile_for_email(
  'player02@gta-marvels.com',
  'gta-marvels',
  'player02',
  'Player Two',
  'player'
);

select public.create_profile_for_email(
  'player03@gta-marvels.com',
  'gta-marvels',
  'player03',
  'Player Three',
  'player'
);

commit;

-- Optional verification:
select
  id,
  username,
  email,
  display_name,
  role,
  team_id
from public.team_profiles
where team_id = 'gta-marvels'
order by
  case when role = 'manager' then 0 else 1 end,
  username;
