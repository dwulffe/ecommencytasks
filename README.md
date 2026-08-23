# Ecommency — Client Task Manager

A simple, Asana-style task board for managing client work, branded in Ecommency's
dark-green style. Add clients, give each one tasks with a **due date** and a
**priority** (High / Medium / Low), and check them off when they're done. The
database is a **Google Sheet** you own, and the app deploys to **Vercel** — put it
on any subdomain like `tasks.ecommency.com`.

- **Front end + API:** Next.js 14 (App Router)
- **Database:** Google Sheets (two tabs — `Clients` and `Tasks`, created automatically)
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
- Everything is saved straight to your Google Sheet, so you can also read or edit
  the data there directly.

---

## 1. Set up the Google Sheet (the database)

You need a Google service account so the app can read and write your sheet.

1. **Create a sheet.** Go to <https://sheets.google.com>, make a new blank
   spreadsheet, and name it something like `Ecommency Tasks`. Copy its ID from
   the URL — it's the long part between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_IS_THE_ID`**`/edit`
   You don't need to add any tabs or headers — the app creates the `Clients` and
   `Tasks` tabs on first use.

2. **Create a Google Cloud project.** Go to
   <https://console.cloud.google.com/projectcreate>, create a project (any name).

3. **Enable the Sheets API.** In that project, open
   <https://console.cloud.google.com/apis/library/sheets.googleapis.com> and click
   **Enable**.

4. **Create a service account.** Go to
   <https://console.cloud.google.com/iam-admin/serviceaccounts>, click
   **Create service account**, give it a name (e.g. `ecommency-tasks`), and
   finish. You don't need to grant it any project roles.

5. **Make a key.** Click the new service account → **Keys** tab → **Add key** →
   **Create new key** → **JSON**. A `.json` file downloads. Inside it you'll find
   `client_email` and `private_key` — you'll use both below.

6. **Share the sheet with the service account.** Open your sheet, click
   **Share**, and share it with the service account's `client_email` (looks like
   `ecommency-tasks@your-project.iam.gserviceaccount.com`) as an **Editor**.
   This is the step people forget — without it you'll get a permissions error.

---

## 2. Run it locally (optional)

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open <http://localhost:3000>. See [Environment variables](#environment-variables)
for what each value is.

> When pasting the private key into `.env.local`, keep it on one line wrapped in
> double quotes with the literal `\n` sequences, exactly as it appears in the JSON
> file. The app converts them back to real line breaks.

---

## 3. Deploy to Vercel

1. Push this project to a GitHub repo (already done if Claude set it up for you).
2. Go to <https://vercel.com/new>, **Import** the repo. Framework preset is
   detected as **Next.js** — no changes needed.
3. Before deploying, add the environment variables (below) under
   **Environment Variables**.
4. Deploy. You'll get a `*.vercel.app` URL.

### Put it on an Ecommency subdomain

1. In the Vercel project → **Settings → Domains**, add `tasks.ecommency.com`
   (or whatever subdomain you like).
2. Vercel shows a **CNAME** record to add. In your DNS provider (wherever
   `ecommency.com` is managed), add:
   `CNAME  tasks  →  cname.vercel-dns.com`
3. Wait for it to verify (usually a few minutes). Done — the app is live on your
   subdomain with HTTPS.

---

## Environment variables

Set these in `.env.local` (local) **and** in Vercel → Settings → Environment
Variables (production). See `.env.example` for a copy-paste template.

| Variable | What it is |
| --- | --- |
| `APP_PASSWORD` | The password your team types to log in. |
| `AUTH_SECRET` | A long random string used to sign the login cookie. Generate with `openssl rand -base64 32`. |
| `GOOGLE_SHEET_ID` | The sheet ID from the URL (step 1). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The `client_email` from the JSON key. |
| `GOOGLE_PRIVATE_KEY` | The `private_key` from the JSON key. In Vercel, paste it exactly as-is (real line breaks are fine). Locally, wrap in quotes and keep the `\n`s. |

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
  3. Add a `CRON_SECRET` env var (any random string) — the route already checks
     for it.
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

The app manages two tabs in your sheet (created automatically):

**Clients** — `id`, `name`, `createdAt`
**Tasks** — `id`, `clientId`, `title`, `priority`, `dueDate`, `done`,
`createdAt`, `completedAt`

You can safely view and lightly edit these in Google Sheets; just don't rename the
header row or the tab names.

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
  sheets.ts               Google Sheets data layer
  auth.ts                 password check + cookie signing
  types.ts                shared types
middleware.ts             gates every page/route behind the password
```
