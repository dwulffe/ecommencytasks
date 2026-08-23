# Ecommency — Client Task Manager

A simple, Asana-style task board for managing client work, branded in Ecommency's
dark-green style. Add clients, give each one tasks with a **due date** and a
**priority** (High / Medium / Low), and check them off when they're done. Data
lives in a **Postgres database** (set up in two clicks on Vercel), and the app
deploys to **Vercel** — put it on any subdomain like `tasks.ecommency.com`.

- **Front end + API:** Next.js 14 (App Router)
- **Database:** Vercel Postgres (Neon) — tables `clients` and `tasks`, created automatically
- **Access:** one shared team password
- **Email reminders:** not wired up yet, but the plumbing is in place — see
  [Adding email reminders](#adding-email-reminders)

---

## What it does

- **Clients** live in the left sidebar. Add one with the box at the bottom; the
  number next to each is its count of open tasks.
- **Tasks** show as rows. Each has a checkbox, a title (click to rename), a
  priority badge (click to cycle High → Medium → Low), and a due date (click to
  set). Overdue and due-soon dates are highlighted.
- **Filter** by Open / Done / All, and **sort** by priority, due date, or newest.

---

## Deploy to Vercel (start to finish)

### 1. Import the repo
1. Go to <https://vercel.com/new> and **Import** `ecommencytasks`.
2. Vercel detects **Next.js** automatically — leave the build settings as-is.
3. Don't deploy yet — first add the database and env vars below.

### 2. Create the database (this is the whole "database setup")
1. In your new Vercel project, open the **Storage** tab → **Create Database**.
2. Choose **Postgres** (powered by Neon) → pick the free plan → **Create**.
3. When it asks, **connect it to this project**. That automatically adds the
   `POSTGRES_URL` (and related) environment variables — you don't type them.
4. The app creates its `clients` and `tasks` tables on first load. Nothing to do by hand.

### 3. Add the app's env vars
Under **Settings → Environment Variables**, add:

| Variable | Value |
| --- | --- |
| `APP_PASSWORD` | The password your team types to log in. Pick anything. |
| `AUTH_SECRET` | A long random string that signs the login cookie. Generate with `openssl rand -base64 32`. |

(The `POSTGRES_*` vars are already there from step 2.)

### 4. Deploy
Hit **Deploy**. You'll get a live `*.vercel.app` URL. Open it, log in with your
`APP_PASSWORD`, and start adding clients and tasks.

### 5. Point it at an Ecommency subdomain
1. Project → **Settings → Domains** → add `tasks.ecommency.com` (or any subdomain).
2. Vercel shows a **CNAME** record. In your DNS provider (wherever `ecommency.com`
   is managed), add: `CNAME  tasks  →  cname.vercel-dns.com`
3. Wait for it to verify (usually a few minutes). Live on your subdomain with HTTPS.

---

## Run it locally (optional)

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

For `POSTGRES_URL` locally, copy it from your Vercel database's **`.env.local`**
tab (Storage → your database → `.env.local`). Then open <http://localhost:3000>.

---

## Environment variables

| Variable | What it is |
| --- | --- |
| `APP_PASSWORD` | The password your team types to log in. |
| `AUTH_SECRET` | A long random string used to sign the login cookie. `openssl rand -base64 32`. |
| `POSTGRES_URL` | The database connection string. **Auto-added by Vercel** when you create the Postgres database; only set by hand for local dev. |

---

## Adding email reminders

Email is intentionally left out for now, but the wiring is ready:

- `app/api/cron/due-reminders/route.ts` already gathers every task that is due
  today or overdue. Hit it and it returns that list as JSON.
- To turn it into real reminders:
  1. Pick a provider (e.g. [Resend](https://resend.com) — easiest with Vercel).
     Add `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, and `REMINDER_TO_EMAIL` env vars.
  2. In that route, replace the `TODO(email)` comment with a call that emails the
     `dueOrOverdue` list.
  3. Add a `CRON_SECRET` env var (any random string) — the route already checks for it.
  4. Add a `vercel.json` with a daily cron so Vercel calls the route each morning:

     ```json
     {
       "crons": [{ "path": "/api/cron/due-reminders", "schedule": "0 13 * * *" }]
     }
     ```

     (`0 13 * * *` is 13:00 UTC — adjust to your timezone.) Vercel sends the cron
     request with `Authorization: Bearer <CRON_SECRET>` automatically when the
     secret is set.

---

## Data model

Two tables, created automatically on first use:

**clients** — `id`, `name`, `created_at`
**tasks** — `id`, `client_id`, `title`, `priority`, `due_date`, `done`,
`created_at`, `completed_at`

Deleting a client cascades to delete its tasks.

---

## Project structure

```
app/
  layout.tsx              root layout + metadata
  globals.css             all Ecommency branding/styles
  page.tsx                renders the board
  login/page.tsx          shared-password login screen
  api/
    auth/login|logout     sets/clears the session cookie
    clients/route.ts      list / add / delete clients
    tasks/route.ts        list / add tasks
    tasks/[id]/route.ts   update (done, priority, due, rename) / delete a task
    cron/due-reminders/   ready-to-extend endpoint for email reminders
components/
  Board.tsx               the whole interactive board
  Logo.tsx                Ecommency mark (inline SVG)
lib/
  db.ts                   Postgres data layer
  auth.ts                 password check + cookie signing
  types.ts                shared types
middleware.ts             gates every page/route behind the password
```
