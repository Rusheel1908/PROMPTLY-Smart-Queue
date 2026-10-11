# Promptly: localhost demo

Everything runs on this laptop: Postgres in Docker, the API on port 4000, the web app on port 5173.

## Start (one command)

In PowerShell, from the repo root:

```powershell
.\scripts\start-demo.ps1
```

It checks Docker and the database container, restarts any servers left on ports 4000/5173, opens two windows
("Promptly API - port 4000" and "Promptly web - port 5173"), waits until both answer, and opens
<http://localhost:5173/>. It needs Docker Desktop running and Node 22+.

**Avast on this laptop:** on 2026-10-11 it quarantined the first version of this script (detection "IDP.Generic")
and stopped the servers it had started; it now blocks any file at the old path, `start-demo.ps1` in the repo root.
The scripts now live in `scripts\` and avoid what it flagged. To be safe before the demo, add the project folder to
Avast's exceptions (Avast: Menu > Settings > General > Exceptions > Add exception, then this folder).

First time on a new machine, it stops and tells you to create the tables, once:

```powershell
cd backend; npm run db:push; npm run db:seed    # the seed prints new staff PINs: update the table below
```

## Phones: the tunnel

Phones can't open `localhost`. A cloudflared quick tunnel gives the running demo a public https address, so the QR
code on a ticket opens on any phone (with live updates, sound, vibration and push notifications).

Install cloudflared once (it asks for admin rights), then open a new PowerShell window:

```powershell
winget install --id Cloudflare.cloudflared
```

Then, with the demo running:

```powershell
.\scripts\start-tunnel.ps1
```

It opens a "Promptly tunnel" window, prints the address (`https://<random words>.trycloudflare.com`), copies it to
the clipboard and opens the kiosk at that address. **Open the kiosk via the tunnel URL so the QR works on phones**: a
ticket printed on `localhost:5173` carries a `localhost` QR that no phone can open. Staff screens (Counter, Ops) can
stay on `localhost:5173`; on the tunnel address you log in again (logins are per tab and per address). The address
changes every time you run it, and closing the tunnel window stops it.

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
| Kiosk for phones | `https://<random words>.trycloudflare.com/kiosk` (printed by `.\scripts\start-tunnel.ps1`) | customer, QR opens on phones |

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

1. `.\scripts\start-demo.ps1`, wait for "Promptly is running".
2. `.\scripts\start-tunnel.ps1`, wait for the public address. It opens the kiosk there: use that tab as the Kiosk.
3. Optional full check (about 20 s, resets the demo at the end):
   `cd backend; npm run demo:smoke -- --asha=211459 --ravi=242651` should end with **All checks passed.**
4. Open the other tabs: Landing, Counter (log in as **Ravi**), Ops (log in as **Asha**), and the Board on a
   second screen if you have one. Have a phone ready (Android Chrome is best for push; on iPhone, push needs the
   page added to the home screen, the page explains how).
5. Ops: **Reset demo**, then **Reset**. Clean state: all 5 counters open with their usual services, learned service
   times cleared, no tokens, one upcoming booking.

## The 5-minute script

| Time | Click | Say |
|---|---|---|
| 0:00 | **Landing** (`/`). Let the 3D queue run. | "Queues lie about waiting times. Promptly makes a promise to every customer and keeps it, or tells them why not." |
| 0:30 | **Kiosk** (the tunnel tab): Deposits, **Get my token**. Scan the ticket's QR with the phone, tap **Notify me** on it, then **Done**. Repeat: Deposits, Loans, Enquiry (D-001, D-002, L-001, E-001). | "Each ticket shows a likely time and a promise that 9 in 10 customers beat. It comes from replaying our real dispatcher 300 times, not from a guess. No app to install: the QR opens the live page." |
| 1:15 | **Counter** (Ravi): **Counter 1**, **Call next** (E-001, earliest deadline). Then **Counter 3**, **Call next**: that calls D-001, the phone's ticket. Point at **Why this customer**, then hold up the phone: "It's your turn", a beep, a buzz and a push notification. | "Staff never pick by hand. The dispatcher is earliest deadline first per customer type, and every call says why. The customer's phone knows within a second." |
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
| "Port 4000/5173 is used by …" | Close that program, run `.\scripts\start-demo.ps1` again. |
| Pages show no numbers, or the header says "Reconnecting…" | The API window stopped. Run `.\scripts\start-demo.ps1` again (it restarts both servers). |
| Wrong PIN / account locked | Check the table above. A locked account opens again after 5 minutes; use Meera meanwhile. |
| "Too many requests, please slow down" (logins, booking codes) | Limits are per IP and in memory: run `.\scripts\start-demo.ps1` again to restart the API. |
| No suggested action appears | Ops: **Add 6 demo customers** to create load, wait a few seconds. |
| Check in says "Check-in opens at …" | That booking is for later (the early rule). Use Ops: **Demo booking: on time**. |
| "Booking code not found" | Check the code (`BK-` and 6 characters, shown in Ops > Today's appointments). |
| **Notify me** is missing | Push is off. `start-demo.ps1` adds keys to `backend/.env` and restarts the API; in-page alerts work anyway. |
| Landing 3D is slow | It lowers the detail by itself when the frame rate drops; carry on, or start the demo from the Kiosk. |
| `start-tunnel.ps1`: "cloudflared is not installed" | `winget install --id Cloudflare.cloudflared`, approve the admin prompt, open a new PowerShell window, run it again. |
| The phone's QR opens `localhost` | That ticket came from a kiosk on `localhost:5173`. Print it from the kiosk on the tunnel address. |
| The tunnel address doesn't load (Cloudflare error 530 or 1033, "can't reach") | The tunnel window was closed or lost its connection: run `.\scripts\start-tunnel.ps1` again (new address: reprint the ticket). A brand-new address can take up to a minute. |
| "Blocked request. This host is not allowed" | The web window is running an old config: run `.\scripts\start-demo.ps1` again. |
| The venue Wi-Fi blocks the tunnel | Skip the phone: press **Track live** on the ticket and show the status page on the laptop. |
| Phone: **Notify me** missing or "blocked" | On the phone, open the tunnel address and allow notifications when asked (if you refused once, allow them in the browser's site settings); on iPhone, Add to Home Screen first. Sound and vibration still work while the page is open. |
| The demo state is a mess | Ops: **Reset demo**. |
| A server window closes by itself, or a script disappears | Avast stopped or quarantined it: open Avast, allow the item (or add the project folder to Exceptions), then run `.\scripts\start-demo.ps1` again. |
| Everything is broken | `git stash` (puts local edits aside), `git checkout main`, then `.\scripts\start-demo.ps1`. |
