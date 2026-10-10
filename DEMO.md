# Promptly: localhost demo

Everything runs on this laptop: Postgres in Docker, the API on port 4000, the web app on port 5173.

## Start (one command)

In PowerShell, from the repo root:

```powershell
.\start-demo.ps1
```

It checks Docker and the database container, restarts any servers left on ports 4000/5173, opens two windows
("Promptly API" and "Promptly web"), waits until both answer, and opens <http://localhost:5173/>.
It needs Docker Desktop running and Node 22+. If PowerShell refuses to run scripts:
`powershell -ExecutionPolicy Bypass -File .\start-demo.ps1`.

First time on a new machine, it stops and tells you to create the tables, once:

```powershell
cd backend; npm run db:push; npm run db:seed    # the seed prints new staff PINs: update the table below
```

## URLs

| Screen | URL | Who |
|---|---|---|
| Landing (3D) | <http://localhost:5173/> | everyone |
| Kiosk | <http://localhost:5173/kiosk> | customer |
| Book a time | <http://localhost:5173/book> | customer |
| Counter console | <http://localhost:5173/counter> | staff login |
| Board (TV) | <http://localhost:5173/board> | display |
| Supervisor ops | <http://localhost:5173/ops> | supervisor login |
| Simulation lab | <http://localhost:5173/lab> | everyone |
| API health | <http://localhost:4000/api/health> | check |

A customer's status page (`/status/…`) and booking page (`/appointment/…`) open from the ticket or booking QR code,
or from **Track live** / **Open my booking**.

## Staff accounts (dev PINs, local database only)

| Name | Role | PIN |
|---|---|---|
| Asha | Supervisor (Ops, counters, verifies priority) | `211459` |
| Ravi | Staff (counter console) | `242651` |
| Meera | Staff (spare) | `123483` |

These PINs exist only in this laptop's Docker database (`npm run db:seed -- --reset-pins`, 2026-10-11). They are
not production PINs: production PINs are never in this repo. A login lasts for one browser tab, so use one tab per
person. Five wrong PINs lock that account for 5 minutes (use Meera meanwhile).

## Before you present (3 minutes)

1. `.\start-demo.ps1`, wait for "Promptly is running".
2. Optional full check (about 20 s, resets the demo at the end):
   `cd backend; npm run demo:smoke -- --asha=211459 --ravi=242651` should end with **All checks passed.**
3. Open the tabs: Landing, Kiosk, Counter (log in as **Ravi**), Ops (log in as **Asha**), and the Board on a
   second screen if you have one.
4. Ops: **Reset demo**, then **Reset**. Clean state: all 5 counters open with their usual services, learned service
   times cleared, no tokens, one upcoming booking.

## The 5-minute script

| Time | Click | Say |
|---|---|---|
| 0:00 | **Landing** (`/`). Let the 3D queue run. | "Queues lie about waiting times. Promptly makes a promise to every customer and keeps it, or tells them why not." |
| 0:30 | **Kiosk**: Deposits, **Get my token**, **Done**. Repeat: Deposits, Loans, Enquiry (D-001, D-002, L-001, E-001). | "Each ticket shows a likely time and a promise that 9 in 10 customers beat. It comes from replaying our real dispatcher 300 times, not from a guess." |
| 1:15 | **Counter** (Ravi): **Counter 1**, **Call next**. Then **Counter 3**, **Call next**. Point at **Why this customer**. | "Staff never pick by hand. The dispatcher is earliest deadline first per customer type, and every call says why." |
| 1:45 | **Kiosk**: Deposits, **Priority**. Asha types her PIN. **Get my token**. | "Priority is verified by staff, never self-selected. And normal customers still have a hard ceiling, so nobody starves." |
| 2:15 | **Counter** (Ravi): **Counter 1**, **Missed**. Open that customer's status page (Track live on their ticket). | "A missed call doesn't send you to the back. The page says you missed it, when to come back, and you keep a place near the front. A second miss is a no-show." |
| 2:45 | **Ops** (Asha), **Counters & what-if**: click Counter 3's status twice (**Closed**), read **Projected impact**, then **Apply 1 change**. Open a waiting customer's status page. | "We simulate before we change anything. Customers see the reason for any new time: **Why my time changed: Counter 3 closed**." |
| 3:30 | **Ops**, **Suggested actions**: e.g. "Add Deposits to Counter 5". **Apply**, **Confirm**. | "The system tries every counter change on the live queue and proposes the best one, with the numbers." |
| 4:00 | **Book** (`/book`): Deposits, any time, **Book this time**: booking code + QR. Then **Ops**, **Today's appointments**: **Demo booking: on time**, **Booking page**, **Check in now**. Then **Demo booking: late**, **Check in at the kiosk**, **Check in**. | "No name or phone number, just a code. On time, you get an appointment token planned around your slot. Late, you join the normal queue, and the ticket says why." |
| 4:40 | **Lab** (`/lab`). | "Same 30 synthetic days for every policy (labeled synthetic): Fairline keeps 89% of promises against 56% for the two baselines, and the longest wait of a normal customer drops from 62–65 to 58 minutes." |
| 4:50 | **Ops**: KPI tiles and **Staff today** (Ravi: 2 calls, 1 miss). | "Supervisors see promises kept, risk, and who marks customers missed." |

The booking you make on `/book` checks in on time only between 15 minutes before and 10 minutes after its slot
(slots run 9:00 to 17:00), so before 08:45 or after 17:10 it shows "Check-in opens at …". That is the early-arrival
rule; say so. The **Demo booking** buttons work at any hour.

Push alerts with the page closed: on a status page tap **Notify me** and allow notifications (Chrome). Without push,
the page still shows a banner, beeps and vibrates.

## If something breaks

| What you see | Do this |
|---|---|
| `start-demo.ps1`: "Docker is not running" | Start Docker Desktop, wait for "Engine running", run it again. |
| `start-demo.ps1`: "tables are missing or out of date" | `cd backend; npm run db:push`, then run it again. A new database also needs `npm run db:seed` (new PINs: update the table above). |
| "Port 4000/5173 is used by …" | Close that program, run `.\start-demo.ps1` again. |
| Pages show no numbers, or the header says "Reconnecting…" | The API window stopped. Run `.\start-demo.ps1` again (it restarts both servers). |
| Wrong PIN / account locked | Check the table above. A locked account opens again after 5 minutes; use Meera meanwhile. |
| "Too many requests, please slow down" (logins, booking codes) | Limits are per IP and in memory: run `.\start-demo.ps1` again to restart the API. |
| No suggested action appears | Ops: **Add 6 demo customers** to create load, wait a few seconds. |
| Check in says "Check-in opens at …" | That booking is for later (the early rule). Use Ops: **Demo booking: on time**. |
| "Booking code not found" | Check the code (`BK-` and 6 characters, shown in Ops > Today's appointments). |
| **Notify me** is missing | Push is off. `start-demo.ps1` adds keys to `backend/.env` and restarts the API; in-page alerts work anyway. |
| Landing 3D is slow | It lowers the detail by itself when the frame rate drops; carry on, or start the demo from the Kiosk. |
| The demo state is a mess | Ops: **Reset demo**. |
| Everything is broken | `git checkout demo-final`, then `.\start-demo.ps1`. |
