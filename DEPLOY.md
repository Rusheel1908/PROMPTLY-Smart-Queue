# Deploying Promptly

| Part | Host | From |
|---|---|---|
| Database | Neon (Postgres) | `backend/prisma/schema.prisma` |
| API + WebSockets | Render web service | `render.yaml`, root dir `backend/` |
| Frontend | Vercel | `frontend/`, `frontend/vercel.json` |

Do the steps in this order: the API needs the database URL, the frontend needs the API URL, and the API's
`CORS_ORIGIN` needs the frontend URL (so you set it last, step 4).

## 1. Neon: create the database

1. Create a project at <https://console.neon.tech>. Pick the region closest to your Render region
   (`render.yaml` uses Singapore, so AWS `ap-southeast-1`).
2. On the project dashboard, open **Connect**, **turn off "Connection pooling"**, and copy the connection string. It
   looks like `postgresql://USER:PASSWORD@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Use the direct (non-pooled) string for both steps below: `prisma db push` needs a direct connection, and the API
   keeps its own small pool. A `-pooler` host would need `&pgbouncer=true` added.

## 2. From your laptop: create the tables and seed

`npm run db:setup` runs `prisma db push` (creates or updates the tables; it stops and asks instead of dropping data)
and then the seed in production mode: the demo branch (4 services, 5 counters) and the 3 staff accounts.

In production mode the seed never generates or prints a PIN. It needs every new account's PIN in `SEED_STAFF_PINS`
(JSON, name → PIN, at least 6 characters each), checks them all before writing anything, and prints only which
accounts it created. Re-running it is safe: existing accounts keep their PINs unless you pass a new one for them.

PowerShell:
```powershell
cd backend
npm install
$env:DATABASE_URL = "postgresql://USER:PASSWORD@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
$env:SEED_STAFF_PINS = '{"Asha":"<6+ chars>","Ravi":"<6+ chars>","Meera":"<6+ chars>"}'
npm run db:setup
Remove-Item Env:SEED_STAFF_PINS, Env:DATABASE_URL   # don't leave them in the shell
```

bash:
```bash
cd backend
npm install
DATABASE_URL='postgresql://…?sslmode=require' \
SEED_STAFF_PINS='{"Asha":"<6+ chars>","Ravi":"<6+ chars>","Meera":"<6+ chars>"}' \
npm run db:setup
```

Expected output ends with:
```
Staff created: Asha (SUPERVISOR), Ravi (STAFF), Meera (STAFF)
Seeded 4 services and 5 counters (demo data).
```

Give each person their PIN yourself; it is stored only as a hash. To change one later, run `db:setup` again with
just that name, e.g. `SEED_STAFF_PINS='{"Ravi":"<new PIN>"}'`.

Values set in the shell take precedence over `backend/.env`, so your local dev database is not touched.

## 3. Render: deploy the API

1. In the Render dashboard: **New → Blueprint**, connect this repository, and pick the branch to deploy. Render reads
   `render.yaml` and proposes the `promptly-api` web service.
2. It asks for the two `sync: false` values:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon string from step 1 |
   | `CORS_ORIGIN` | your Vercel URL if you already know it (e.g. `https://promptly.vercel.app`), else `http://localhost:5173` for now and fix it in step 4 |

   It also asks for the optional notification settings (leave the VAPID ones empty to skip push for now):

   | Variable | Value |
   |---|---|
   | `TZ` | the branch's time zone, e.g. `Asia/Kolkata`, so "come back by 10:42" in notifications is local time |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | from `npm run push:keys` (see [Phone notifications](#phone-notifications-web-push)) |

   Set by the Blueprint itself: `NODE_ENV=production`, `TRUST_PROXY=1`. Render sets `PORT`.
3. **Apply**. The build runs `npm ci --include=dev && npx prisma generate && npm run build`, then `npm start`
   (Node 22, from `engines` in `backend/package.json`). Render waits for `GET /api/health` to answer
   `{"ok":true}` before routing traffic.
4. Note the service URL, e.g. `https://promptly-api.onrender.com`, and check
   `https://promptly-api.onrender.com/api/health`.

The `free` plan in `render.yaml` sleeps after 15 minutes without traffic: the first request then takes ~1 minute,
and the sweeper (call windows, re-forecasts) is paused while it sleeps. Change `plan` to `starter` for a real branch.

If the service fails to start, its log lists every invalid variable (`Invalid configuration, refusing to start: …`).

## 4. Vercel: deploy the frontend

1. **Add New → Project**, import this repository.
2. Settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `frontend` |
   | Framework Preset | Vite (build `npm run build`, output `dist`, detected automatically) |
   | Node.js Version (Settings → General) | 22.x |

3. Environment variable (Production, and Preview if you use preview deployments):

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | the Render URL from step 3, e.g. `https://promptly-api.onrender.com` (no `/api`) |

   It is baked in at build time: the API calls go to `VITE_API_URL/api/…` and the live updates to
   `wss://…/ws` (derived from the same URL). After changing it, **redeploy**.
4. Deploy, and note the URL, e.g. `https://promptly.vercel.app`.
5. Back in Render, set `CORS_ORIGIN` on `promptly-api` to that exact origin (scheme + host, no path). Add more,
   comma-separated, for a custom domain or a preview URL: `https://promptly.vercel.app,https://queue.example.com`.
   Saving it redeploys the API.

`frontend/vercel.json` rewrites every path to `index.html`, so `/kiosk`, `/board`, `/status/<id>?k=…` (the ticket QR
links), `/ops`, `/lab` and page refreshes load the app instead of a 404.

## 5. Check it

- `https://<vercel-url>/` shows the landing page. On `/kiosk` the header's live dot turns on (WebSocket connected).
- `/kiosk`: issue a token, scan the QR with a phone, and the status page opens.
- `/counter`: log in as Asha with the PIN from step 2 and call the token; `/board` updates without a refresh.
- If screens load but show no data: the browser console shows a CORS error (fix `CORS_ORIGIN`) or requests to the
  wrong host (fix `VITE_API_URL` and redeploy). WebSockets from an origin not in `CORS_ORIGIN` are refused with 403.

## Phone notifications (Web Push)

Customers who tap **Notify me** on their status page get alerts with the page closed: almost up, called, last call,
missed turn (with the time to come back), no-show and big delays. Without push they still get in-page alerts (banner,
beep, vibration) while the page is open.

1. On your laptop: `cd backend && npm run push:keys`. It prints three lines.
2. In Render, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret) and `VAPID_SUBJECT` (replace the example
   `mailto:` with a real contact). All three or none: a partial set stops the API at startup with a clear message.
3. Nothing to set on Vercel: the frontend fetches the public key from `GET /api/push/key`, and serves the service
   worker (`/sw.js`) and web app manifest from `frontend/public`.

Keep the same keys from then on: new keys invalidate every subscription (customers would have to tap Notify me again).
Push needs HTTPS (Vercel provides it). Android Chrome and desktop browsers work in a normal tab; an iPhone only after
**Share → Add to Home Screen**, opened from the home screen (the status page shows this hint). The API only sends to
the browsers' push services (`PUSH_HOSTS` in `backend/src/config.ts`).

## Environment variables

**Render (`promptly-api`)**

| Variable | Value | Secret |
|---|---|---|
| `DATABASE_URL` | Neon direct connection string, `sslmode=require` | yes |
| `CORS_ORIGIN` | frontend origin(s), comma-separated | no |
| `NODE_ENV` | `production` (Blueprint) | no |
| `TRUST_PROXY` | `1` (Blueprint) | no |
| `PORT` | set by Render | no |
| `TZ` | branch time zone, e.g. `Asia/Kolkata` (optional) | no |
| `VAPID_PUBLIC_KEY` | from `npm run push:keys` (optional, with the other two) | no |
| `VAPID_PRIVATE_KEY` | from `npm run push:keys` | yes |
| `VAPID_SUBJECT` | `mailto:` or `https:` contact | no |

**Vercel**

| Variable | Value |
|---|---|
| `VITE_API_URL` | Render service URL |

**Laptop, only while running `npm run db:setup`**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon direct connection string |
| `SEED_STAFF_PINS` | `{"Asha":"…","Ravi":"…","Meera":"…"}`: required for every account that doesn't exist yet |

## Schema changes later

Run `npm run db:setup` again from your laptop (with `DATABASE_URL`; `SEED_STAFF_PINS` only if an account is new or
needs a new PIN) before or right after Render deploys the code that needs the change. If `prisma db push` reports
that a change would lose data, it stops; decide what to do with that data before going further.
