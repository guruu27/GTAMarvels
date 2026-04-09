# TeamFlow Scheduler

A GitHub Pages friendly scheduling app inspired by SportEasy, now backed by Supabase Auth and role-based database access.

## What changed

- Managers can create and edit events, postpone fixtures, seed demo data, and view the complete team availability board.
- Players can sign in, reset their password, view upcoming events, and submit only their own availability.
- Username or email can be used for sign in.
- Password reset is handled through Supabase email recovery links.

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

### 4. Create auth users

Open `Authentication -> Users` and create the accounts you need, for example:

- one manager account
- one or more player accounts

Use real email addresses if you want password reset emails to work.

### 5. Link users to the team and roles

After creating the auth users, run SQL like this in the SQL editor:

```sql
select public.ensure_team_exists('gta-marvels', 'GTA Marvels');

select public.create_profile_for_email(
  'manager@example.com',
  'gta-marvels',
  'manager01',
  'Team Manager',
  'manager'
);

select public.create_profile_for_email(
  'player@example.com',
  'gta-marvels',
  'player07',
  'Player Seven',
  'player'
);
```

Now the manager can see the full team board, while the player can only update their own row.

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
- Public sign-up is not implemented in this app. Accounts are provisioned in Supabase Auth and then linked to roles with SQL.
- The login form accepts username or email. Password resets still go to the user's email address.
- The database policies, not just the UI, enforce that players can only read and write their own availability.
