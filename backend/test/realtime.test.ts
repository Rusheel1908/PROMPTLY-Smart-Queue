import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { attachRealtime } from '../src/realtime.js';
import { issue, PIN, resetDb } from './helpers.js';

type Msg = { type: string; data: Record<string, unknown> };

let server: Server;
let client: WebSocket;
const messages: Msg[] = [];

beforeAll(async () => {
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

/** Resolve once `n` announce messages have arrived (or fail after 3 s). */
const announcements = (n: number) => new Promise<Msg[]>((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    const got = messages.filter((m) => m.type === 'announce');
    if (got.length >= n) return resolve(got);
    if (Date.now() - started > 3000) return reject(new Error(`only ${got.length} announce messages`));
    setTimeout(poll, 20);
  };
  poll();
});

describe('public broadcasts', () => {
  it('announce carries the code and counter, never the token id', async () => {
    const world = await resetDb();
    const t = await issue(server, world.deposits.id);
    await request(server).post(`/api/counters/${world.counter.id}/call-next`).set(PIN).expect(200);
    await request(server).post(`/api/counters/${world.counter.id}/recall`).set(PIN).expect(200);

    const [call, recall] = await announcements(2);
    expect(call.data).toEqual({ code: t.code, counter: 'Counter 1', recall: false });
    expect(recall.data).toEqual({ code: t.code, counter: 'Counter 1', recall: true });

    // nothing pushed to the public socket (announce or queue pings) identifies the token
    const raw = JSON.stringify(messages);
    expect(raw).not.toContain(t.id);
    expect(raw).not.toContain(t.secret);
    expect(raw).not.toContain('tokenId');
  });
});
