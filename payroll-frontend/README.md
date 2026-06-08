# PayrollPro — Front-end (web app)

This is the **visual website** for PayrollPro. It talks to your live backend API
(hosted on Render) and gives you a login screen, dashboard, employees, payroll
runs, payslips, reports and an audit log.

The backend (the Render service `payrollpro-api`) does the work; this is the UI.

## How to use it

### Option A — Open it right now (no deploy)
Just double-click `index.html`. It opens in your browser and connects to your
live API at `https://payrollpro-api.onrender.com`.

### Option B — Put it online with Vercel (recommended)
This is a **static** site, so Vercel runs it perfectly (no crashes).

1. Go to https://vercel.com → **Add New… → Project**.
2. Import a repo containing this folder, OR drag-and-drop this folder.
3. Framework preset: **Other**. Build command: leave empty. Output dir: leave empty.
4. Click **Deploy**. You get a URL like `https://your-app.vercel.app`.

> The crashing Vercel project you saw was the *backend* code. Delete/ignore it.
> Vercel should host the **front-end** (this folder); Render hosts the backend.

## Changing the API URL
If your backend ever moves, click **Advanced: API server URL** on the login
screen and paste the new base URL. It's saved in your browser.

## Logins (from the seeded demo data)
- `admin@acme.ph` — HR Admin (full access)
- `finance@acme.ph` — Finance
- `manager@acme.ph` — Manager
- `employee@acme.ph` — Employee self-service

Password = the `BOOTSTRAP_ADMIN_PASSWORD` you set on Render.

## Note on free hosting
The free Render backend sleeps after ~15 min idle, so the **first** login can
take 30–50 seconds while it wakes up. The login screen shows a “waking up”
notice during that time. Subsequent requests are fast.
