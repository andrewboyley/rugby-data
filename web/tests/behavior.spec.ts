import { test, expect } from '@playwright/test';

test('test page loads and start layout initiates', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.waitForTimeout(1000);
  
  // Click Start Layout - this should initiate the force-directed layout
  await page.click('button:has-text("Start Layout")');
  await page.waitForTimeout(3000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors:', errors);
  console.log('Sigma errors:', sigmaErrors);
  
  // The button should change to "Stop Layout" after clicking start
  const stopBtn = page.locator('button:has-text("Stop Layout")');
  await expect(stopBtn).toBeVisible({ timeout: 5000 });
  
  expect(sigmaErrors.length).toBe(0);
});

test('navigate back to main page', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173/test');
  await page.waitForTimeout(1000);
  
  await page.click('button[title="Back to main"]');
  await page.waitForTimeout(1000);
  
  const sigmaErrors = errors.filter(e => e.includes('Sigma') || e.includes('Container'));
  console.log('All errors on return:', errors);
  expect(sigmaErrors.length).toBe(0);
  
  await expect(page.locator('h1')).toContainText('Rugby co-occurrence graph');
});