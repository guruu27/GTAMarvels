# TeamFlow Scheduler

A GitHub Pages friendly scheduling app inspired by SportEasy, now backed by Supabase Auth and role-based database access.

## What changed

- Managers can create and edit events, postpone fixtures, seed demo data, and view the complete team availability board.
- Players can self-register, sign in, reset their password, view upcoming events, and submit only their own availability.
- Username or email can be used for sign in.
- Password reset is handled through Supabase email recovery links.
- Managers are still created manually in Supabase and never through the public sign-up form.

## Stack

- HTML5
- Modern CSS
- Vanilla JavaScript
- GitHub Pages for hosting
- Supabase Auth + Postgres + Row Level Security

## Local run

```bash
cd /root/SportEasy
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Config

Edit `config.js` locally or provide these through GitHub Actions:

```js
window.TEAMFLOW_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  teamId: "gta-marvels",
  teamName: "GTA Marvels",
};
```

`config.example.js` shows the same structure.

## Supabase project setup

### 1. Create the project

- In Supabase, create a normal blank project.
- Choose the region closest to your team.
- If Supabase asks for a framework example, choose `JavaScript` or `Vanilla JS`.

### 2. Run the schema

- Open `SQL Editor`
- Run `supabase-schema.sql`

This creates:

- `teams`
- `team_profiles`
- `team_events`
- `team_event_availability`
- an auth trigger that provisions `player` profiles after self-signup confirmation
- role-based RLS policies
- helper SQL functions for onboarding accounts

### 3. Configure Auth URLs

Open `Authentication -> URL Configuration` and add:

- `Site URL`
  - For local testing: `http://localhost:4173`
  - For GitHub Pages: `https://YOUR_USERNAME.github.io/YOUR_REPO`
- `Redirect URLs`
  - `http://localhost:4173/`
  - `https://YOUR_USERNAME.github.io/YOUR_REPO/`

These are required for password reset links to send users back into the app.

### 4. Enable player self-signup

- Open `Authentication -> Providers -> Email`
- Make sure `Email` is enabled
- Turn `Allow new users to sign up` on
- Keep `Confirm email` on if you want players to verify email before first sign-in

The app's public sign-up form only provisions `player` accounts. It cannot create managers.

### 5. Create the manager account manually

Open `Authentication -> Users` and create your manager account manually.

Use a real email address if you want password reset emails to work.

Then link that manager account to the team in SQL:

```sql
select public.ensure_team_exists('gta-marvels', 'GTA Marvels');

select public.create_profile_for_email(
  'manager@example.com',
  'gta-marvels',
  'manager01',
  'Team Manager',
  'manager'
);
```

After that:

- managers sign in with the email or username you assigned
- players use the app's `Player sign up` tab to create their own account
- once a player confirms their email, the database trigger creates their `player` profile automatically

### 6. Optional seed users

If you want demo accounts instead of self-registering players one by one:

- create the auth users in `Authentication -> Users`
- run [supabase-seed-team-users.sql](/root/SportEasy/supabase-seed-team-users.sql)

## GitHub Pages deployment

### 1. Enable Pages

In GitHub:

- `Settings -> Pages`
- Set `Source` to `GitHub Actions`

### 2. Add Actions secrets

In `Settings -> Secrets and variables -> Actions`, add:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_BOARD_ID`

`SUPABASE_BOARD_ID` is still used by the workflow as the team id. Set it to the same value as `teamId`, for example:

- `gta-marvels`

### 3. Push and deploy

Push to `main` or re-run the Pages workflow.

Your site will be available at:

- `https://YOUR_USERNAME.github.io/YOUR_REPO/`

## Important notes

- Use the Supabase `Publishable key`, never the `service_role` key, in the browser.
- Public sign-up creates `player` accounts only. Manager accounts must still be created manually.
- The login form accepts username or email. Password resets still go to the user's email address.
- The database policies, not just the UI, enforce that players can only read and write their own availability.
- If you already ran an older version of `supabase-schema.sql`, run the updated file again so the self-signup column, trigger, and policies are added.
