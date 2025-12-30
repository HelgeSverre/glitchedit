import { test, expect } from '@playwright/test';

test.describe('GlitchEdit App', () => {
  test('loads without console errors', async ({ page }) => {
    const errors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      errors.push(err.message);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    if (errors.length > 0) {
      console.log('Console errors found:', errors);
    }
    expect(errors).toEqual([]);
  });

  test('has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GĻƗŦÇĦɆĐƗŦ/);
  });

  test('loads random image on startup', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#preview-canvas')).toBeVisible();
  });

  test('can open help dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('#btn-help');
    await expect(page.locator('#help-dialog')).toBeVisible();

    // Check help content is populated
    await expect(page.locator('.help-category')).toHaveCount(7); // 7 effect categories
  });

  test('can close help dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('#btn-help');
    await expect(page.locator('#help-dialog')).toBeVisible();

    await page.click('#help-close');
    await expect(page.locator('#help-dialog')).not.toBeVisible();
  });

  test('can add effect when image is loaded', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for image to load
    await expect(page.locator('#preview-canvas')).toBeVisible();

    // Click add effect button
    await page.click('#btn-add-effect');

    // Effect picker should be visible
    await expect(page.locator('#effect-picker')).toBeVisible();

    // Click first effect
    await page.click('#effect-picker .effect-option:first-child');

    // Layer should be added
    await expect(page.locator('#layer-list .layer-item')).toHaveCount(1);
  });

  test('effects module loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that effects are registered
    const effectCount = await page.evaluate(() => {
      // Access effectRegistry from the module
      return window.effectRegistry?.size || 0;
    });

    // Effects should be loaded (we can't access module scope from page, but we can check the picker)
    await page.click('#btn-add-effect');
    const pickerOptions = await page.locator('#effect-picker .effect-option').count();
    expect(pickerOptions).toBe(48); // 48 effects
  });

  test('glitch button adds random effects', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for image to load (button should be enabled)
    await expect(page.locator('#btn-randomize-effects')).toBeEnabled({ timeout: 5000 });

    // Click the Glitch button
    await page.click('#btn-randomize-effects');

    // Wait a moment for effects to be processed
    await page.waitForTimeout(1000);

    // Should have added 3-6 layers
    const layerCount = await page.locator('#layer-list .layer-item').count();
    expect(layerCount).toBeGreaterThanOrEqual(3);
    expect(layerCount).toBeLessThanOrEqual(6);
  });
});
