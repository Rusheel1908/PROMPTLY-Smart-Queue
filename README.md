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
   npm run db:seed         # demo branch: 4 services, 5 counters (labeled demo data)
   npm run dev             # http://localhost:4000/api/health
   npm test                # engine + simulator tests
   ```
3. Frontend (second terminal)
   ```
   cd frontend
   cp .env.example .env
   npm install
   npm run dev             # http://localhost:5173
   ```

Staff screens (Counter, Ops) and priority classes at the kiosk need the staff PIN: `STAFF_PIN` in `backend/.env` (default `1234`).

## Screens
| Route | Who | What |
|---|---|---|
| `/` | Customer | Kiosk: live wait band per service, staff-verified priority, ticket with QR |
| `/status/:id` | Customer | ETA band, promise, people ahead, "why my time changed", step away / cancel, your-turn alert |
| `/counter` | Staff | Call next with "why this customer", call-window ring, recall / missed / redirect, keyboard shortcuts |
| `/board` | Display | Now calling with chime + voice, counters, up next |
| `/ops` | Supervisor | KPIs, promise-risk heatmap, what-if planner (simulate, then apply), live event log, demo tools |
| `/lab` | Anyone | Simulation lab: B1, B2, Fairline + 4 ablations on identical synthetic days |

## Layout
```
backend/src/engine/   pure TS: dispatcher (policies + fast path), forecaster, duration model, state machine, ledger
backend/src/sim/      synthetic workload + discrete-event evaluator (baselines, ablations)
backend/src/services/ queue (load/replan/snapshot), actions (all mutations, serialized), sweeper (auto recall/miss)
backend/src/routes/   tokens (public, rate-limited), counters (staff), ops (snapshot, what-if, demo, lab)
frontend/src/pages/   Kiosk, Status, Counter, Board, Ops, Lab
```

All evaluation data is synthetic. Results are hypotheses until measured in a real branch.
