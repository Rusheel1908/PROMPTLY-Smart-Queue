import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { attachRealtime } from '../src/realtime.js';
import { startLabJob } from '../src/services/labJobs.js';
import { SPECS } from '../src/sim/evaluate.js';
import { as, resetDb } from './helpers.js';

type Msg = { type: string; data: Record<string, unknown> };

let server: Server;
let client: WebSocket;
const messages: Msg[] = [];

beforeAll(async () => {
  await resetDb(); // staff accounts + sessions
  server = createServer(createApp());
  attachRealtime(server);
  server.listen(0);
  await once(server, 'listening');
  client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
  client.on('message', (raw) => messages.push(JSON.parse(String(raw))));
  await once(client, 'open');
});

afterAll(async () => {
  client.close();
  server.close();
  await prisma.$disconnect();
});

const SMALL = { days: 1, runs: 10, policies: ['F'] };
const HEAVY = { days: 3, runs: 40 }; // all policies, a few seconds of CPU (arrival sampling makes each day ~2× costlier)

const start = (body: object) => request(server).post('/api/lab/run').set(as()).send(body);
const job = (id: string) => request(server).get(`/api/lab/jobs/${id}`).set(as()).expect(200).then((r) => r.body);

/** Poll a job until `done(status)` holds (or fail after `ms`). */
async function waitFor(id: string, done: (status: string) => boolean, ms = 30_000) {
  const started = Date.now();
  for (;;) {
    const j = await job(id);
    if (done(j.status)) return j;
    if (Date.now() - started > ms) throw new Error(`job ${id} still ${j.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const finished = (s: string) => s === 'done' || s === 'failed';

describe('lab access', () => {
  it('starting a live run needs a supervisor session', async () => {
    await request(server).post('/api/lab/run').send(SMALL).expect(401);
    await request(server).post('/api/lab/run').set({ 'x-staff-pin': '1234' }).send(SMALL).expect(401);
  });

  it('rejects out-of-range params with 400', async () => {
    await start({ days: 99 }).expect(400);
  });

  it('unknown job → 404', async () => {
    await request(server).get('/api/lab/jobs/nope').set(as()).expect(404);
  });
});

describe('live runs', () => {
  it('202 with a job id, and the job reaches done with a live result', async () => {
    const { body } = await start(SMALL).expect(202);
    expect(body).toEqual({ jobId: expect.any(String) });
    const j = await waitFor(body.jobId, finished);
    expect(j.status).toBe('done');
    expect(j.progress).toBe(1);
    expect(j.result.source).toBe('live');
    expect(j.result.results.map((r: { id: string }) => r.id)).toEqual(['F']);
  });

  it('only one run at a time: a second request gets 409', async () => {
    const first = await start(SMALL).expect(202);
    const second = await start(SMALL).expect(409);
    expect(second.body.error).toMatch(/already in progress/);
    expect((await waitFor(first.body.jobId, finished)).status).toBe('done');
  });

  it('the main thread stays free while a job runs', async () => {
    const { body } = await start(HEAVY).expect(202);
    await waitFor(body.jobId, (s) => s !== 'queued');
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await request(server).get('/api/health').expect(200);
      timings.push(performance.now() - t0);
    }
    // the job must still be running after the last health check, or this proved nothing
    expect((await job(body.jobId)).status).toBe('running');
    for (const ms of timings) expect(ms).toBeLessThan(250);
    expect((await waitFor(body.jobId, finished)).status).toBe('done');
  });

  it('broadcasts a "lab" message with only the job id and status', async () => {
    const { body } = await start(SMALL).expect(202);
    await waitFor(body.jobId, finished);
    await expect.poll(() => messages.find((m) => m.type === 'lab' && m.data.jobId === body.jobId)).toBeTruthy();
    const msg = messages.find((m) => m.type === 'lab' && m.data.jobId === body.jobId)!;
    expect(msg.data).toEqual({ jobId: body.jobId, status: 'done' });
  });

  it('a hard timeout terminates the worker, fails the job and frees the slot', async () => {
    const timedOut = startLabJob(HEAVY, { timeoutMs: 50 });
    const j = await waitFor(timedOut.id, finished, 5_000);
    expect(j).toMatchObject({ status: 'failed', error: expect.stringMatching(/Timed out/) });
    const next = await start(SMALL).expect(202);
    await waitFor(next.body.jobId, finished);
  });
});

describe('saved result', () => {
  it('/lab/latest is public and returns the pre-computed 30-day run', async () => {
    const { body } = await request(server).get('/api/lab/latest').expect(200);
    expect(body).toMatchObject({ source: 'precomputed', synthetic: true, days: 30, params: { days: 30, seed: 1 } });
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(Object.keys(SPECS));
  });
});
