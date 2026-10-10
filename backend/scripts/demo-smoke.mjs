/**
 * Demo smoke test: runs the 5-minute demo story against a running API and checks every step.
 *   npm run demo:smoke -- --asha=<PIN> --ravi=<PIN> [--api=http://localhost:4000] [--keep]
 * PINs can also come from ASHA_PIN / RAVI_PIN. It RESETS THE DEMO DATA (first and, unless --keep, last),
 * so it refuses any API that is not on localhost.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const API = `${String(args.api ?? 'http://localhost:4000').replace(/\/+$/, '')}/api`;
const PIN = { Asha: args.asha ?? process.env.ASHA_PIN, Ravi: args.ravi ?? process.env.RAVI_PIN };

if (!['localhost', '127.0.0.1'].includes(new URL(API).hostname)) throw new Error(`Refusing to reset a non-local API (${API})`);
if (!PIN.Asha || !PIN.Ravi) throw new Error('Pass the dev PINs: --asha=<PIN> --ravi=<PIN> (see DEMO.md)');

let failures = 0;
const ok = (cond, what, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${what}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
  return cond;
};
const step = (title) => console.log(`\n${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method, json, session, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (json === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(session && { Authorization: `Bearer ${session}` }), ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const must = async (path, opts, expected = [200, 201]) => {
  const r = await call(path, opts);
  if (!expected.includes(r.status)) throw new Error(`${opts?.method ?? (opts?.json ? 'POST' : 'GET')} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
/** Poll until `pick` returns something truthy (notifications and suggestions are computed in the background). */
const until = async (fn, pick, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = pick(await fn());
    if (v || Date.now() > end) return v;
    await sleep(500);
  }
};

async function login(name) {
  const staff = await must('/auth/staff');
  const me = staff.find((s) => s.name === name) ?? (() => { throw new Error(`No staff account named ${name}`); })();
  return (await must('/auth/login', { json: { staffId: me.id, pin: PIN[name] } })).token;
}

step('0. API and logins');
ok((await must('/health')).ok === true, 'API answers /health');
const asha = await login('Asha');
const ravi = await login('Ravi');
ok(!!asha && !!ravi, 'Asha (supervisor) and Ravi (staff) log in with their dev PINs');
const push = await must('/push/key');
ok(true, 'Web Push', push.publicKey ? 'on (VAPID key set)' : 'off: in-page alerts only (no VAPID keys)');

step('1. Reset demo → clean state');
await must('/demo/reset', { json: {}, session: asha });
let snap = await must('/snapshot', { session: asha });
ok(snap.counters.length === 5 && snap.counters.every((c) => c.status === 'OPEN'), 'all 5 counters OPEN');
const SEEDED = { 'Counter 1': 'D,E', 'Counter 2': 'C,D,E', 'Counter 3': 'D,L', 'Counter 4': 'L', 'Counter 5': 'C,E' };
const prefixOf = Object.fromEntries(snap.services.map((s) => [s.id, s.prefix]));
const skills = (c) => c.skills.map((id) => prefixOf[id]).sort().join(',');
ok(snap.counters.every((c) => SEEDED[c.name] === skills(c)), 'seeded skills', snap.counters.map((c) => `${c.name}=${skills(c)}`).join(' '));
ok(snap.services.every((s) => s.learnedFrom === 0), 'learned service times cleared');
ok(snap.tokens.length === 0, 'no tokens');
const today = await must('/ops/appointments', { session: asha });
ok(today.appointments.length <= 1 && today.counts.BOOKED === today.appointments.length, 'one upcoming booking', today.appointments[0]
  ? `${today.appointments[0].code} at ${new Date(today.appointments[0].slotStart).toLocaleTimeString()}` : 'booked for tomorrow (after 16:40 today)');

const svc = Object.fromEntries(snap.services.map((s) => [s.prefix, s]));
const counter = Object.fromEntries(snap.counters.map((c) => [c.name, c]));

step('2. Kiosk: D, D, L, E');
const issued = [];
for (const p of ['D', 'D', 'L', 'E']) issued.push(await must('/tokens', { json: { serviceId: svc[p].id, class: 'NORMAL' } }));
ok(issued.length === 4, 'four tokens', issued.map((t) => t.code).join(' '));
ok(issued.every((t) => t.etaP50 && t.promiseP90), 'each has an ETA and a promise');
const appt400 = await call('/tokens', { json: { serviceId: svc.D.id, class: 'APPOINTMENT' } });
ok(appt400.status === 400, 'kiosk cannot pick APPOINTMENT', `${appt400.status} ${appt400.body.error}`);
const keyOf = Object.fromEntries(issued.map((t) => [t.id, t.secret]));

step('3. Ravi calls next on Counter 1 and Counter 3 (with reasons)');
const c1 = await must(`/counters/${counter['Counter 1'].id}/call-next`, { json: {}, session: ravi });
const c3 = await must(`/counters/${counter['Counter 3'].id}/call-next`, { json: {}, session: ravi });
ok(!!c1.token && !!c1.reason, `Counter 1 calls ${c1.token?.code}`, c1.reason);
ok(!!c3.token && !!c3.reason, `Counter 3 calls ${c3.token?.code}`, c3.reason);

step('4. Priority token (Asha at the kiosk)');
const pri = await must('/tokens', { json: { serviceId: svc.D.id, class: 'PRIORITY' }, session: asha });
ok(pri.class === 'PRIORITY', `priority token ${pri.code}`);
const pri403 = await call('/tokens', { json: { serviceId: svc.D.id, class: 'PRIORITY' } });
ok(pri403.status === 403, 'without staff: 403');

step('5. Ravi marks Counter 1 missed → status page shows it');
const missed = await must(`/counters/${counter['Counter 1'].id}/miss`, { json: {}, session: ravi });
ok(missed.outcome === 'WAITING', 'first miss: back in the queue near the front (a second miss is a no-show)', missed.outcome);
const missedView = await until(
  () => must(`/tokens/${c1.token.id}`, { headers: { 'x-token-key': keyOf[c1.token.id] } }),
  (t) => (t.notifications.some((n) => n.event === 'MISSED') ? t : null),
);
ok(missedView?.missCount === 1 && Date.parse(missedView.notBefore) > Date.now(),
  `${c1.token.code} re-enters at ${missedView && new Date(missedView.notBefore).toLocaleTimeString()}`);
const missedNote = missedView?.notifications.find((n) => n.event === 'MISSED');
ok(!!missedNote, 'notification', missedNote && `${missedNote.title}. ${missedNote.body}`);

step('6. Asha closes Counter 3 → ETA reasons');
await must(`/counters/${counter['Counter 3'].id}`, { method: 'PATCH', json: { status: 'CLOSED' }, session: asha });
const waiting = issued.filter((t) => t.id !== c1.token.id && t.id !== c3.token?.id);
const reasons = [];
for (const t of [...waiting, c3.token].filter(Boolean)) {
  const d = await must(`/tokens/${t.id}`, { headers: { 'x-token-key': keyOf[t.id] } });
  d.changes.forEach((c) => reasons.push(`${t.code}: ${c.reason}`));
}
ok(reasons.some((r) => /Counter 3/.test(r)), 'a status page explains the change', reasons.find((r) => /Counter 3/.test(r)) ?? reasons.join(' | '));

step('7. Suggestion appears → apply');
let sugg = await until(() => must('/ops/suggestions', { session: asha }), (s) => s.suggestions[0], 8000);
if (!sugg) {
  console.log('    (no suggestion with this little load: adding 6 demo customers, as the demo script does)');
  await must('/demo/spawn', { json: { count: 6 }, session: asha });
  sugg = await until(() => must('/ops/suggestions', { session: asha }), (s) => s.suggestions[0], 15000);
}
if (ok(!!sugg, 'a suggestion', sugg?.explanation)) {
  const applied = await call(`/ops/suggestions/${sugg.id}/apply`, { json: {}, session: asha });
  ok(applied.status === 200, 'applied', applied.status === 200 ? '' : JSON.stringify(applied.body));
}

step('8. Appointments: book, on-time check-in, late check-in');
const slots = await must(`/appointments/slots?serviceId=${svc.D.id}`);
const booked = await must('/appointments', { json: { serviceId: svc.D.id, slotStart: slots.slots[0].start } });
ok(/^BK-[A-Z0-9]{6}$/.test(booked.code) && !!booked.secret, `booked ${booked.code} for ${new Date(booked.slotStart).toLocaleString()}`);
const early = await call('/appointments/check-in', { json: { code: booked.code } });
ok([200, 409].includes(early.status), 'kiosk check-in of that booking', early.status === 409 ? early.body.error : `on time: ${early.body.token?.code}`);
const onTime = await must('/demo/booking', { json: { timing: 'on-time' }, session: asha });
const onTimeIn = await must(`/appointments/${onTime.id}/check-in`, { json: {}, headers: { 'x-appointment-key': onTime.secret } });
ok(onTimeIn.token.class === 'APPOINTMENT', `on time → ${onTimeIn.token.code} (${onTimeIn.token.class})`);
const late = await must('/demo/booking', { json: { timing: 'late' }, session: asha });
const lateIn = await must('/appointments/check-in', { json: { code: late.code } });
ok(lateIn.token.class === 'NORMAL' && lateIn.appointment.status === 'LATE_DOWNGRADED', `late → ${lateIn.token.code} (${lateIn.token.class})`);
const lateView = await until(
  () => must(`/tokens/${lateIn.token.id}`, { headers: { 'x-token-key': lateIn.token.secret } }),
  (t) => (t.notifications.some((n) => n.event === 'APPT_LATE') ? t : null),
);
ok(lateView?.appointment?.note === 'Arrived after your check-in window', 'status note', lateView?.appointment?.note);
ok(!!lateView?.notifications.find((n) => n.event === 'APPT_LATE'), 'notification', lateView?.notifications.find((n) => n.event === 'APPT_LATE')?.title);

step('9. Lab, metrics, staff stats');
const lab = await must('/lab/latest');
ok(lab.results?.length > 0, `Lab saved results: ${lab.results?.length} policies, ${lab.days} days`);
const m = await must('/metrics');
ok(m.issued > 0 && m.missed >= 1, 'metrics', `issued ${m.issued}, served ${m.served}, missed turns ${m.missed}, no-shows ${m.noShows}`);
const stats = await must('/ops/staff-stats', { session: asha });
const r = stats.staff.find((s) => s.name === 'Ravi');
ok(r?.calls >= 2 && r?.misses >= 1, 'staff stats', `Ravi: ${r?.calls} calls, ${r?.misses} miss`);

if (!args.keep) {
  step('10. Reset demo again, ready to present');
  await must('/demo/reset', { json: {}, session: asha });
  snap = await must('/snapshot', { session: asha });
  ok(snap.tokens.length === 0 && snap.counters.every((c) => c.status === 'OPEN'), 'clean state');
}
await call('/auth/logout', { json: {}, session: asha });
await call('/auth/logout', { json: {}, session: ravi });

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
