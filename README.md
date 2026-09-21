# Ecommency — Client Task Manager

A simple, Asana-style task board for managing client work, branded in Ecommency's
dark-green style. Add clients, give each one tasks with a **due date** and a
**priority** (High / Medium / Low), and check them off when they're done. Data
lives in a **Postgres database** (set up in two clicks on Vercel), and the app
deploys to **Vercel** — put it on any subdomain like `tasks.ecommency.com`.

- **Front end + API:** Next.js 14 (App Router)
- **Database:** Vercel Postgres (Neon) — tables created automatically
- **Access:** per-user logins with roles. **Admins** see everything and manage
  people; **employees** see only tasks assigned to them.
- **Time tracking:** each task has a Start/Pause timer; completing a task banks
  the time, shown against the completed task.
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
- **Email → tasks (AI):** forward a client email to a special address and Claude
  reads it, pulls out the action items, and drops them in a **“Suggested from
  email”** area for that client — you click **Accept** to turn one into a real
  task, or **×** to dismiss. See [Email → tasks](#email--tasks-ai).

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
| `ADMIN_USERNAME` | Your admin login username (e.g. `admin`). |
| `ADMIN_PASSWORD` | Your admin password. The admin account is auto-created from these on first run. |
| `AUTH_SECRET` | A long random string that signs the login cookie. Generate with `openssl rand -base64 32`. |

(The `POSTGRES_*` vars are already there from step 2. If you previously set
`APP_PASSWORD`, it still works as a fallback for `ADMIN_PASSWORD`.)

**Roles & logins:** Log in as the admin, then open the **Team** panel in the
sidebar to add employees (username + password). Employees sign in with those and
see only the tasks you assign to them. You assign a task via the dropdown under
its title. Each task has a Start/Pause timer; marking a task done stops the timer
and records the total time.

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
| `ANTHROPIC_API_KEY` | For the email → tasks feature. Claude reads forwarded emails and extracts action items. Optional if you don't use that feature. |
| `INBOUND_TOKEN` | Shared secret protecting the `/api/inbound` webhook. Optional if you don't use email → tasks. |
| `EXTRACT_MODEL` | Optional. Which Claude model extracts tasks (default `claude-opus-5`). |

---

## Email → tasks (AI)

Forward a client email to a special address; Claude reads it and suggests tasks.

**How it flows:** an email-forwarding service receives the forwarded email → POSTs
it to `/api/inbound` on your app → the app matches it to a client by email
address/domain → Claude extracts the action items → they appear as **suggestions**
you approve in the UI.

### 1. Give each client an email/domain
In the sidebar, when you add a client, fill in the **email or domain** field
(e.g. `hello@yuzuco.com` or just `yuzuco.com`). That's how forwarded emails get
matched to the right client. No match = the email is ignored.

### 2. Add two environment variables (Vercel → Settings → Environment Variables)
| Variable | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | From <https://console.anthropic.com> → API Keys. |
| `INBOUND_TOKEN` | Any random string — it protects the webhook. |

Redeploy after adding them.

### 3. Set up forwarding to the webhook
Use any inbound-email service that can POST to a URL. **CloudMailin** is the
simplest (gives you a ready-made address, no DNS needed):

1. Sign up at <https://www.cloudmailin.com>, create an address. It gives you one
   like `abc123@cloudmailin.net`.
2. Set its **POST target / webhook URL** to:
   `https://YOUR-APP.vercel.app/api/inbound?token=YOUR_INBOUND_TOKEN`
   and the format to **JSON**.
3. In Gmail, create a filter (or just BCC/forward manually) so client emails go
   to that `@cloudmailin.net` address. Tip: filter on the client's domain so it
   auto-forwards everything from them.

That's it. Forward a client email and within a few seconds the extracted tasks
show up under that client as **Suggested from email**.

> Works with other providers too (Postmark, SendGrid Inbound Parse, Mailgun) — the
> webhook accepts their JSON/form payloads. Point their inbound webhook at the same
> `/api/inbound?token=...` URL.

**Cost:** each forwarded email is one small Claude call — pennies at normal volume.
Set `EXTRACT_MODEL=claude-haiku-4-5` to make it even cheaper.

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

**users** — `id`, `username`, `name`, `password_hash`, `role`, `created_at`
**clients** — `id`, `name`, `email`, `created_at`
**tasks** — `id`, `client_id`, `title`, `priority`, `due_date`, `done`,
`created_at`, `completed_at`, `assignee_id`, `timer_started_at`,
`time_spent_seconds`
**suggestions** — `id`, `client_id`, `title`, `priority`, `due_date`,
`source_subject`, `source_from`, `created_at` (pending email-extracted tasks)

Deleting a client cascades to delete its tasks and suggestions. Passwords are
stored only as salted scrypt hashes.

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
