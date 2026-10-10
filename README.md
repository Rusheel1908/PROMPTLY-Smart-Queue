[![CI](https://github.com/Rusheel1908/PROMPTLY-Smart-Queue/actions/workflows/ci.yml/badge.svg)](https://github.com/Rusheel1908/PROMPTLY-Smart-Queue/actions/workflows/ci.yml)

# Promptly: Fairline smart queue (Team Alpha, CBC015)

Promise-aware queue management. Tokens are dispatched by **class-adjusted earliest-deadline-first** with a hard
wait ceiling (no starvation). Every token's call time is **forecast by replaying the real dispatcher**
(Monte Carlo, 300 runs, learned lognormal service times), the P90 is frozen as a **promise**, and every ETA change is
**explained** on the customer's status page.

## Run locally
1. PostgreSQL (Docker):
   `docker run -d --name promptly-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=promptly -p 5432:5432 postgres:16`
2. Backend
   ```
   cd backend
   cp .env.example .env
   npm install
   npx prisma db push      # creates tables from prisma/schema.prisma
   npm run db:seed         # demo branch: 4 services, 5 counters, 3 staff accounts (prints their dev PINs once)
   npm run dev             # http://localhost:4000/api/health
   npm test                # engine tests + API tests (API tests use a separate promptly_test DB, created automatically)
   npm run lab:snapshot    # optional: regenerate src/sim/precomputed.json (the Lab's saved 30-day result, ~15 s)
   ```
3. Frontend (second terminal)
   ```
   cd frontend
   cp .env.example .env
   npm install
   npm run dev             # http://localhost:5173
   ```

Every variable is documented in `backend/.env.example`. To deploy (Neon, Render, Vercel), see [DEPLOY.md](DEPLOY.md).

**Staff accounts.** Each staff member logs in with their own name and PIN. Every action they take is logged with their
staff id, so calls, completes and misses can be audited per person. The seed creates three demo accounts:

| Name | Role | Can |
|---|---|---|
| Asha | Supervisor | everything below, plus open / pause / close counters and change skills, apply suggestions, what-if, reactivate no-shows, live Lab runs, demo tools, Ops and the staff miss audit |
| Ravi, Meera | Staff | call next, recall, start, complete, miss, redirect, issue priority tokens at the kiosk |

The table lives in one place, `backend/src/lib/permissions.ts`; routes name an action and the frontend greys out what
the logged-in role cannot do. In dev, `npm run db:seed` gives each new account a random 6-digit PIN and prints it once;
`npm run db:seed -- --reset-pins` issues new ones. In production the seed never generates or prints PINs: pass them as
`SEED_STAFF_PINS='{"Asha":"…","Ravi":"…","Meera":"…"}'` (at least 6 characters each). PINs are stored as salted scrypt
hashes. A login opens a 12-hour session (only its hash is stored; the browser keeps the token in sessionStorage, so
closing the tab logs out). Five wrong PINs lock an account for 5 minutes, and failed logins are rate-limited per IP.

> Upgrading from the shared `STAFF_PIN`: run `npx prisma db push` (adds the `Staff` and `Session` tables; nothing else
> changes) and `npm run db:seed`, then remove `STAFF_PIN` from `backend/.env`. Old events keep the actor `staff` and
> show as "Staff (shared PIN)".

**Token privacy.** Each token has a random secret, returned once when it is issued and embedded in the ticket QR as
`/status/:id?k=<secret>`. Viewing, stepping away from or cancelling a token needs that key (`x-token-key` header) or a
staff session; anything else gets a 404. Without a session, `/api/snapshot` and the WebSocket carry only what the board shows
(codes, services, states, counters, ETAs), with no token ids.

> Upgrading an existing dev database: the new `Token.secret` column is required, so clear the demo tokens first.
> Either press **Reset demo** on `/ops` while the old version is still running, or run
> `echo 'TRUNCATE "EtaChange", "Event", "Token" RESTART IDENTITY;' | npx prisma db execute --stdin`.
> Then `npx prisma db push`. Services and counters are kept either way.

## What happens if the server restarts
Postgres is the source of truth: every token, counter and the full event log live there, so a crash or redeploy loses
no customer's place. What lives only in memory, and how it comes back:

| In memory | On restart |
|---|---|
| Forecast ETAs and the per-service quotes on the kiosk | Rebuilt by a full re-forecast at boot (seeded, so the same queue gives the same numbers) |
| Sweeper timers (call window, 30 s re-forecast) | Restarted at boot |
| A customer who was being called | Their call window counts from `lastCallAt` in the database, so the downtime counts too: the sweeper recalls or misses them on its first pass |
| The one-at-a-time action queue (`serial()`) | Starts empty. A request cut off mid-way fails for its caller, who can retry. Known gap: an action's token update and its event row are separate writes, so a crash exactly between them leaves the token right but its event missing from the log |
| Rate-limit counters | Start from zero (a brief allowance, not a data loss) |
| Live Lab runs | Lost: their job ids answer 404, and staff can start a new run. The saved Lab result is a file, so it is unaffected |

Screens reconnect to the WebSocket by themselves (backoff up to 8 s) and refresh on the next queue update, at most 30 s
later. `backend/test/restart.test.ts` proves this: it crashes and reboots the API mid-scenario and checks the snapshot is
the same, the next call picks the same customer, and called customers are still recalled and missed on time.
`backend/test/eventReplay.test.ts` rebuilds every token's state from the event log alone and checks it against the table.

## Screens
| Route | Who | What |
|---|---|---|
| `/` | Customer | Kiosk: live wait band per service, staff-verified priority, ticket with QR |
| `/status/:id?k=…` | Customer | ETA band, promise, people ahead, "why my time changed", step away / cancel, your-turn alert |
| `/counter` | Staff | Call next with "why this customer", call-window ring, recall / missed / redirect, keyboard shortcuts |
| `/board` | Display | Now calling with chime + voice, counters, up next |
| `/ops` | Supervisor | Staff miss audit (per-person calls, completes, misses; high miss rates flagged), suggested actions (the system simulates counter changes and proposes the best, one click to apply), KPIs, promise-risk heatmap, what-if planner (simulate, then apply), live event log, demo tools |
| `/lab` | Anyone (view) / Supervisor (run live) | Simulation lab: B1, B2, Fairline + 4 ablations on identical synthetic days. Opens on a saved pre-computed result; live runs execute in a worker thread, one at a time, 60 s limit |

## Layout
```
backend/src/engine/   pure TS: dispatcher (policies + fast path), forecaster, duration model, state machine, ledger
backend/src/sim/      synthetic workload + discrete-event evaluator (baselines, ablations), Lab worker entry, saved snapshot
backend/src/services/ queue (load/replan/snapshot), actions (all mutations, serialized), sweeper (auto recall/miss), lab jobs (worker threads)
backend/src/routes/   auth (login, sessions), tokens (public, rate-limited), counters (staff), ops (snapshot, what-if, staff stats, demo, lab)
frontend/src/pages/   Kiosk, Status, Counter, Board, Ops, Lab
```

All evaluation data is synthetic. Results are hypotheses until measured in a real branch.
