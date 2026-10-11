import { test, expect } from '@playwright/test';

test.describe('Food Rescue End-to-End Suite', () => {

  test('new contributor completes a post in 8 or fewer interactions', async ({ page, context }) => {
    // Mock geolocation to seed center
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });

    await page.goto('/post');
    await page.waitForLoadState('networkidle');

    let interactions = 0;

    // Interaction 1: select meals chip "20"
    await page.getByRole('button', { name: '20', exact: true }).click();
    interactions++;

    // Interaction 2: select Diet Veg
    await page.getByRole('button', { name: /Veg 🥬/i }).click();
    interactions++;

    // Interaction 3: select Ready For 3h
    await page.getByRole('button', { name: /3h|3 घंटे/i }).click();
    interactions++;

    // Interaction 4: type phone number
    await page.locator('#input-phone').fill('9876543210');
    interactions++;

    // Interaction 5: type shop name
    await page.locator('#input-shop-name').fill('New Donor Shop');
    interactions++;

    // Wait for button to be enabled (at least 800ms bot check)
    await page.waitForTimeout(900);

    // Interaction 6: tap Post button
    await page.locator('#btn-post-food').click();
    interactions++;

    // Confirmation page appears
    await expect(page.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });

    console.log(`New contributor interactions: ${interactions} (budget: <= 8)`);
    expect(interactions).toBeLessThanOrEqual(8);
  });

  test('returning contributor completes a post in 3 or fewer interactions', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });

    // Seed localStorage as returning contributor
    await page.addInitScript(() => {
      localStorage.setItem('food_rescue_phone', '9876543210');
      localStorage.setItem('food_rescue_shop_name', 'Returning Donor Shop');
    });

    await page.goto('/post');
    await page.waitForLoadState('networkidle');

    let interactions = 0;

    // Interaction 1: change meal chip to 30
    await page.getByRole('button', { name: '30', exact: true }).click();
    interactions++;

    // Wait bot check
    await page.waitForTimeout(900);

    // Interaction 2: tap Post food
    await page.locator('#btn-post-food').click();
    interactions++;

    await expect(page.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });

    console.log(`Returning contributor interactions: ${interactions} (budget: <= 3)`);
    expect(interactions).toBeLessThanOrEqual(3);
  });

  test('shop link completes a post in 3 or fewer interactions', async ({ page }) => {
    await page.goto('/s/shop_greenleaf');
    await page.waitForLoadState('networkidle');

    let interactions = 0;

    // Green Leaf already has location, phone, and defaults prefilled!
    await page.waitForTimeout(900);

    // Interaction 1: tap Post food directly!
    await page.locator('#btn-post-food').click();
    interactions++;

    await expect(page.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });

    console.log(`Shop link interactions: ${interactions} (budget: <= 3)`);
    expect(interactions).toBeLessThanOrEqual(3);
  });

  test('smart one-line input parses and posts in 2 interactions', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });

    await page.addInitScript(() => {
      localStorage.setItem('food_rescue_phone', '9876543210');
    });

    await page.goto('/post');
    await page.waitForLoadState('networkidle');

    let interactions = 0;

    // Interaction 1: type smart one-line input
    await page.locator('#smart-input').fill('20 veg cooked 3h');
    interactions++;

    await page.waitForTimeout(900);

    // Interaction 2: tap Post
    await page.locator('#btn-post-food').click();
    interactions++;

    await expect(page.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });

    console.log(`One-line input interactions: ${interactions}`);
    expect(interactions).toBeLessThanOrEqual(3);
  });

  test('offline draft is kept and sent after reconnect', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 12.9716, longitude: 77.5946 });

    await page.addInitScript(() => {
      localStorage.setItem('food_rescue_phone', '9876543210');
    });

    await page.goto('/post');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '20', exact: true }).click();
    await page.waitForTimeout(900);

    // Set offline
    await context.setOffline(true);

    // Tap Post food while offline
    await page.locator('#btn-post-food').click();

    // Offline notice appears
    await expect(page.locator('text=Draft saved, sending automatically when reconnected')).toBeVisible();

    // Reconnect network
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Confirmation appears
    await expect(page.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });
  });

  test('NGO offer appears in second browser context and Accept works', async ({ browser }) => {
    // Context 1: NGO
    const ngoContext = await browser.newContext({
      permissions: ['geolocation', 'notifications'],
      geolocation: { latitude: 12.9716, longitude: 77.5946 }
    });
    const ngoPage = await ngoContext.newPage();

    // Login as NGO
    await ngoPage.goto('/login');
    await ngoPage.locator('#login-phone').fill('9100000001');
    await ngoPage.locator('#login-password').fill('ngo123');
    await ngoPage.locator('#btn-login-submit').click();
    await ngoPage.waitForURL('/ngo');

    // Go online
    const onlineBtn = ngoPage.locator('#btn-toggle-online');
    const isOnlineText = await onlineBtn.innerText();
    if (isOnlineText.includes('GO ONLINE')) {
      await onlineBtn.click();
      await expect(onlineBtn).toContainText('ONLINE', { timeout: 5000 });
    }

    // Context 2: Contributor posts 25 meals
    const userContext = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 12.9716, longitude: 77.5946 }
    });
    const userPage = await userContext.newPage();
    await userPage.goto('/post');
    await userPage.locator('#smart-input').fill('25 veg cooked 3h');
    await userPage.locator('#input-phone').fill('9777777777');
    await userPage.waitForTimeout(900);
    await userPage.locator('#btn-post-food').click();
    await expect(userPage.locator('text=Food Posted Successfully')).toBeVisible({ timeout: 10000 });

    // NGO screen receives offer
    await expect(ngoPage.locator('#btn-accept-trip')).toBeVisible({ timeout: 15000 });

    // Accept trip
    await ngoPage.locator('#btn-accept-trip').click({ force: true });

    // Status advances to active trip
    await expect(ngoPage.locator('text=Next Stop:')).toBeVisible({ timeout: 10000 });

    await ngoContext.close();
    await userContext.close();
  });

  test('admin overview displays time-to-post and audit metrics', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-phone').fill('9000000000');
    await page.locator('#login-password').fill('admin123');
    await page.locator('#btn-login-submit').click();
    await page.waitForURL('/admin');

    await expect(page.locator('text=Command Center')).toBeVisible();
    await expect(page.locator('text=Time-to-Post Performance')).toBeVisible();
  });

  test('the three public routes work at 360 by 640 with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });

    // Route 1: Home
    await page.goto('/');
    const scrollHome = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(scrollHome).toBe(true);

    // Route 2: /post
    await page.goto('/post');
    const scrollPost = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(scrollPost).toBe(true);

    // Route 3: /s/shop_greenleaf
    await page.goto('/s/shop_greenleaf');
    const scrollShop = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(scrollShop).toBe(true);
  });

});
