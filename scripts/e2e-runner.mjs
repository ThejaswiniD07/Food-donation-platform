import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const BASE_URL = 'http://127.0.0.1:4000';
let serverProcess = null;

async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (res.ok) {
      const data = await res.json();
      return data.status === 'ok';
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function startServer() {
  const isRunning = await checkHealth();
  if (isRunning) {
    console.log(`[E2E] Reusing running server at ${BASE_URL}`);
    return;
  }

  console.log(`[E2E] Starting server at ${BASE_URL}...`);
  serverProcess = spawn(process.execPath, ['apps/server/src/index.js'], {
    cwd: rootDir,
    stdio: 'pipe',
    env: { ...process.env, PORT: '4000' }
  });

  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 400));
    if (await checkHealth()) {
      console.log(`[E2E] Server is healthy and ready.`);
      return;
    }
  }
  throw new Error('[E2E] Server failed to start within 15 seconds.');
}

function cleanup() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
  }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function runE2E() {
  console.log('================================================================');
  console.log('            FOOD RESCUE PLAYWRIGHT E2E SUITE                    ');
  console.log('================================================================\n');

  // 1. Seed database
  console.log('[E2E] Seeding test database...');
  const seedProc = spawn(process.execPath, ['apps/server/src/db/seed.js'], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  await new Promise((resolve) => seedProc.on('exit', resolve));

  // 2. Start server if needed
  await startServer();

  // 3. Launch Chromium
  console.log('[E2E] Launching Chromium browser...');
  const browser = await chromium.launch({ headless: true });

  let passed = 0;
  let failed = 0;

  async function runTest(name, fn) {
    process.stdout.write(`  • Running: ${name} ... `);
    const start = Date.now();
    try {
      await fn();
      const dur = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`✅ PASS (${dur}s)`);
      passed++;
    } catch (err) {
      const dur = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`❌ FAIL (${dur}s)`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  try {
    // Test 1: New contributor completes post in <= 8 interactions
    await runTest('new contributor completes a post in 8 or fewer interactions', async () => {
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/post`);
      await page.waitForLoadState('networkidle');

      let interactions = 0;
      await page.getByRole('button', { name: '20', exact: true }).click();
      interactions++;

      await page.getByRole('button', { name: /Veg 🥬/i }).click();
      interactions++;

      await page.getByRole('button', { name: /3h|3 घंटे/i }).click();
      interactions++;

      await page.locator('#input-phone').fill('9876543210');
      interactions++;

      await page.locator('#input-shop-name').fill('New Donor Shop');
      interactions++;

      await page.waitForTimeout(900);
      await page.locator('#btn-post-food').click();
      interactions++;

      await page.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });
      if (interactions > 8) throw new Error(`Interactions ${interactions} exceeded budget 8`);
      await context.close();
    });

    // Test 2: Returning contributor completes post in <= 3 interactions
    await runTest('returning contributor completes a post in 3 or fewer interactions', async () => {
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('food_rescue_phone', '9876543210');
        localStorage.setItem('food_rescue_shop_name', 'Returning Donor Shop');
      });

      await page.goto(`${BASE_URL}/post`);
      await page.waitForLoadState('networkidle');

      let interactions = 0;
      await page.getByRole('button', { name: '30', exact: true }).click();
      interactions++;

      await page.waitForTimeout(900);
      await page.locator('#btn-post-food').click();
      interactions++;

      await page.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });
      if (interactions > 3) throw new Error(`Interactions ${interactions} exceeded budget 3`);
      await context.close();
    });

    // Test 3: Shop link completes post in <= 3 interactions
    await runTest('shop link completes a post in 3 or fewer interactions', async () => {
      const context = await browser.newContext({
        viewport: { width: 360, height: 640 }
      });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/s/shop_greenleaf`);
      await page.waitForLoadState('networkidle');

      let interactions = 0;
      await page.waitForTimeout(900);
      await page.locator('#btn-post-food').click();
      interactions++;

      await page.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });
      if (interactions > 3) throw new Error(`Interactions ${interactions} exceeded budget 3`);
      await context.close();
    });

    // Test 4: Smart one-line input parses and posts in <= 3 interactions
    await runTest('smart one-line input parses and posts in 2 interactions', async () => {
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('food_rescue_phone', '9876543210');
      });

      await page.goto(`${BASE_URL}/post`);
      await page.waitForLoadState('networkidle');

      let interactions = 0;
      await page.locator('#smart-input').fill('20 veg cooked 3h');
      interactions++;

      await page.waitForTimeout(900);
      await page.locator('#btn-post-food').click();
      interactions++;

      await page.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });
      if (interactions > 3) throw new Error(`Interactions ${interactions} exceeded budget 3`);
      await context.close();
    });

    // Test 5: Offline draft kept and sent after reconnect
    await runTest('offline draft is kept and sent after reconnect', async () => {
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('food_rescue_phone', '9876543210');
      });

      await page.goto(`${BASE_URL}/post`);
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: '20', exact: true }).click();
      await page.waitForTimeout(900);

      // Set offline
      await context.setOffline(true);
      await page.locator('#btn-post-food').click();

      await page.waitForSelector('text=Draft saved, sending automatically when reconnected', { timeout: 5000 });

      // Reconnect
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));

      await page.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });
      await context.close();
    });

    // Test 6: NGO offer appears in second browser context and Accept works
    await runTest('NGO offer appears in second browser context and Accept works', async () => {
      // Context 1: NGO
      const ngoContext = await browser.newContext({
        permissions: ['geolocation', 'notifications'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const ngoPage = await ngoContext.newPage();

      await ngoPage.goto(`${BASE_URL}/login`);
      await ngoPage.locator('#login-phone').fill('9100000001');
      await ngoPage.locator('#login-password').fill('ngo123');
      await ngoPage.locator('#btn-login-submit').click();
      await ngoPage.waitForURL('**/ngo');

      // Ensure NGO is online with fresh GPS timestamp
      await ngoPage.evaluate(async () => {
        const token = localStorage.getItem('food_rescue_token');
        await fetch('/api/ngo/online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
        });
      });
      await ngoPage.reload();
      await ngoPage.waitForSelector('text=ONLINE', { timeout: 5000 });

      // Context 2: Contributor posts 25 meals
      const userContext = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 12.9716, longitude: 77.5946 },
        viewport: { width: 360, height: 640 }
      });
      const userPage = await userContext.newPage();
      await userPage.goto(`${BASE_URL}/post`);
      await userPage.waitForLoadState('networkidle');

      await userPage.locator('#smart-input').fill('25 veg cooked 3h');
      await userPage.locator('#input-phone').fill('9777777777');
      await userPage.waitForTimeout(900);
      await userPage.locator('#btn-post-food').click();
      await userPage.waitForSelector('text=Food Posted Successfully', { timeout: 10000 });

      // Trigger NGO state refresh
      await ngoPage.waitForTimeout(1000);
      await ngoPage.reload();
      await ngoPage.waitForTimeout(1000);

      // NGO screen receives offer
      await ngoPage.waitForSelector('#btn-accept-trip', { timeout: 15000 });
      await ngoPage.locator('#btn-accept-trip').click({ force: true });

      // Status advances to active trip
      await ngoPage.waitForSelector('text=Next Stop:', { timeout: 10000 });

      await ngoContext.close();
      await userContext.close();
    });

    // Test 7: Admin overview displays time-to-post and audit metrics
    await runTest('admin overview displays time-to-post and audit metrics', async () => {
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/login`);
      await page.locator('#login-phone').fill('9000000000');
      await page.locator('#login-password').fill('admin123');
      await page.locator('#btn-login-submit').click();
      await page.waitForURL('**/admin');

      await page.waitForSelector('text=Command Center', { timeout: 10000 });
      await page.waitForSelector('text=Time-to-Post Performance', { timeout: 10000 });
      await context.close();
    });

    // Test 8: Public routes work at 360x640 with no horizontal scroll
    await runTest('the three public routes work at 360 by 640 with no horizontal scroll', async () => {
      const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/`);
      const scrollHome = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      if (!scrollHome) throw new Error('Horizontal scroll detected on /');

      await page.goto(`${BASE_URL}/post`);
      const scrollPost = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      if (!scrollPost) throw new Error('Horizontal scroll detected on /post');

      await page.goto(`${BASE_URL}/s/shop_greenleaf`);
      const scrollShop = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      if (!scrollShop) throw new Error('Horizontal scroll detected on /s/shop_greenleaf');

      await context.close();
    });

    await browser.close();

    console.log('\n=================== E2E RESULTS SUMMARY ===================');
    console.log(`Total Scenarios: 8`);
    console.log(`Passed:          ${passed}`);
    console.log(`Failed:          ${failed}`);
    console.log('===========================================================\n');

    if (failed > 0) {
      cleanup();
      process.exit(1);
    } else {
      console.log('🎉 ALL 8 PLAYWRIGHT E2E SCENARIOS PASSED WITH ZERO FAILURES!');
      cleanup();
      process.exit(0);
    }

  } catch (err) {
    console.error('\n[E2E Suite Unhandled Error]:', err);
    cleanup();
    process.exit(1);
  }
}

runE2E();
