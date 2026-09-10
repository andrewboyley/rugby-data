import { test, expect } from '@playwright/test';

test('main page loads without Sigma errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors:', errors);
  console.log('Sigma errors:', sigmaErrors);
  
  expect(sigmaErrors.length).toBe(0);
  
  // Check for main page content
  await expect(page.locator('h1')).toContainText('Rugby co-occurrence graph');
});

test('test page at /test loads without Sigma errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.waitForTimeout(2000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors:', errors);
  console.log('Sigma errors:', sigmaErrors);
  
  expect(sigmaErrors.length).toBe(0);
  
  // Check for test page content: sidebar tabs, graph canvas, back button
  await expect(page.getByRole('button', { name: 'ForceAtlas2' })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('button[title="Back to main"]')).toBeVisible();
});

test('navigates back to main page via button', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.waitForTimeout(2000);
  
  // Click back button
  await page.click('button[title="Back to main"]');
  await page.waitForTimeout(1000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors:', errors);
  console.log('Sigma errors:', sigmaErrors);
  
  expect(sigmaErrors.length).toBe(0);
  
  // Check we're back on main page
  await expect(page.locator('h1')).toContainText('Rugby co-occurrence graph');
});
