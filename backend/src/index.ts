import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

const port = Number(process.env.PORT ?? 4000);
const server = createServer(createApp());
attachRealtime(server);
server.listen(port, () => console.log(`Promptly API on http://localhost:${port}  (ws: /ws)`));
