import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('🚀 Starting Food Rescue in development mode...');
console.log('   - Server API & WebSocket at http://localhost:4000');
console.log('   - Vite Dev Server at http://localhost:3000\n');

const serverProcess = spawn('node', ['apps/server/src/index.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, PORT: '4000' }
});

const viteCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const webProcess = spawn(viteCmd, ['vite', 'apps/web'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env }
});

const cleanup = () => {
  try { serverProcess.kill(); } catch (e) {}
  try { webProcess.kill(); } catch (e) {}
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
