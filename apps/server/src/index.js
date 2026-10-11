import http from 'http';
import https from 'https';
import path from 'path';
import dotenv from 'dotenv';
import selfsigned from 'selfsigned';
import { fileURLToPath } from 'url';
import { createDb } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { initWebPush } from './services/push.js';
import { wsManager } from './services/websocket.js';
import { defaultClock } from './services/clock.js';
import { runDispatchLoop } from './services/dispatch.js';
import { createApp } from './app.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-food-rescue-2026';
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/app.db');
const IS_HTTPS = process.env.HTTPS === 'true';

// 1. Initialize DB
const db = createDb(DB_PATH);

// 2. Seed if empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  seedDatabase(db);
}

// 3. Initialize Web Push
initWebPush(db);

// 4. Create App
const app = createApp({ db, clock: defaultClock, jwtSecret: JWT_SECRET, wsManager });

// 5. Create Server (HTTP or HTTPS)
let server;
if (IS_HTTPS) {
  const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 365 });
  server = https.createServer({ key: pems.private, cert: pems.cert }, app);
} else {
  server = http.createServer(app);
}

// 6. Initialize WebSocket
wsManager.init(server, JWT_SECRET);

// 7. Start Dispatch Ticker (every 5 seconds)
setInterval(() => {
  runDispatchLoop({ db, clock: defaultClock, wsManager });
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const protocol = IS_HTTPS ? 'https' : 'http';
  console.log(`Food Rescue server listening on ${protocol}://localhost:${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Unhandled Rejection caught]:', reason);
});
