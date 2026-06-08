# Deploying PayrollPro for free

**Vercel will not work** for this project — it's a long-running Express server with a PostgreSQL database, and Vercel only runs stateless serverless functions with no built-in database. Use a host that runs persistent Node services. The easiest free one is **Render**.

---

## Option A — Render (recommended, free, no card to start)

The included `render.yaml` sets everything up automatically: a free web service **and** a free PostgreSQL database, already wired together.

### Steps
1. **Put the code on GitHub.**
   ```bash
   cd payrollpro
   git init && git add . && git commit -m "PayrollPro"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/payrollpro.git
   git push -u origin main
   ```
2. Go to **https://render.com** → sign up (free) → **New → Blueprint**.
3. Connect your GitHub repo. Render detects `render.yaml` and shows the plan (1 web service + 1 database, both **Free**).
4. When prompted, set the two secret values:
   - **FIELD_ENCRYPTION_KEY** — generate a 64-character hex key locally and paste it:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - **BOOTSTRAP_ADMIN_PASSWORD** — choose a strong password (this is your first HR Admin login).
5. Click **Apply**. First deploy takes ~2–4 minutes (it installs, migrates, seeds, then starts).
6. Open the service URL, e.g. `https://payrollpro-api.onrender.com/health` → should return `{"ok":true}`.
7. Log in:
   ```bash
   curl -s https://payrollpro-api.onrender.com/api/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"admin@acme.ph","password":"<the password you set>"}'
   ```

### Free-tier caveats (important)
- The free **web service sleeps after ~15 min idle**; the next request takes ~30–50s to wake. Fine for testing/demos, not for production traffic.
- Render's free **PostgreSQL expires after ~30 days**. For something longer-lived and still free, use **Neon** (below) and just paste its connection string into `DATABASE_URL`.

---

## Option B — Render web service + Neon Postgres (free, longer-lived DB)

[Neon](https://neon.tech) offers a free Postgres tier that doesn't expire in 30 days.

1. Create a free Neon project → copy the connection string (looks like `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
2. In `render.yaml`, **remove the `databases:` block** and change the `DATABASE_URL` env var to `sync: false`.
3. Deploy the blueprint as in Option A; paste the Neon string into `DATABASE_URL` when prompted.
4. SSL is already handled (the app enables SSL automatically when `NODE_ENV=production`).

---

## Other free-friendly hosts
- **Railway** (https://railway.app) — gives a one-click Postgres + Node; small monthly trial credit (free to start, then usage-based).
- **Fly.io** (https://fly.io) — Docker-based; you already have a `Dockerfile`. Has a free allowance. Run `fly launch` then `fly postgres create`.
- **Koyeb** (https://koyeb.com) — free web service tier; pair with Neon for the DB.

## Why not Vercel / Netlify?
They're optimized for static front-ends and short stateless functions. This backend needs (1) a persistent process and (2) a real database connection pool — neither fits their serverless model, which is exactly why you saw `FUNCTION_INVOCATION_FAILED`. If you later build a separate front-end SPA, *that* can live on Vercel and call this API.
