# TeamFlow Scheduler

A static scheduling web app inspired by SportEasy's calendar flow, designed to run on GitHub Pages and optionally store shared data in Supabase.

## Stack

- HTML5
- Modern CSS
- Vanilla JavaScript
- GitHub Pages for hosting
- Supabase for optional cloud persistence

## Features

- Month, week, and agenda calendar views
- Event creation and editing
- Weekly recurring event creation
- Game, practice, tournament, and team-event types
- Attendance tracking with RSVP and check-in states
- Cancel, postpone, restore, and reschedule flows
- Update feed and seeded demo data
- Local-only mode or shared Supabase-backed mode

## Run locally

From `/root/SportEasy`:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Local config

- `config.js` keeps the app in local browser-storage mode.
- `config.example.js` shows the values needed for Supabase mode.

## Supabase setup

1. Create a new Supabase project.
2. In the Supabase SQL editor, run `supabase-schema.sql`.
3. Open `Project Settings -> API` and copy:
   - Project URL
   - Publishable key
4. Pick a board id, for example `northside-falcons`.

## GitHub Pages deployment

This repo includes `.github/workflows/deploy-pages.yml` for GitHub Pages.

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. In `Settings -> Secrets and variables -> Actions`, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_BOARD_ID`
5. Push to `main` or run the workflow manually.
6. GitHub will publish the site at:
   - `https://YOUR_USERNAME.github.io/YOUR_REPO/`

## Notes

- The Supabase policies in `supabase-schema.sql` make the board publicly editable. That is fine for a public demo or openly shared team board.
- If you need private team access, the next step is adding Supabase Auth and stricter Row Level Security policies.
