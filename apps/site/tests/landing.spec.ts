import { test, expect } from '@playwright/test';

test.describe('Hanzo.app Landing Page', () => {
  test('has correct title and heading', async ({ page }) => {
    await page.goto('/');
    
    // Check title
    await expect(page).toHaveTitle('Hanzo - AI Development Platform for Every Device');
    
    // Check main heading - use first() in case there are multiple h1 elements
    const heading = page.locator('h1').first();
    await expect(heading).toContainText('AI Development');
    await expect(heading).toContainText('Everywhere You Code');
  });

  test('displays all platform download cards', async ({ page }) => {
    await page.goto('/');
    
    // Check all download cards are present
    const downloadCards = page.locator('.download-card');
    await expect(downloadCards).toHaveCount(9);
    
    // Check specific platforms - scope to download cards to be more specific
    const downloadSection = page.locator('.download-grid');
    await expect(downloadSection.locator('text=Desktop App')).toBeVisible();
    await expect(downloadSection.locator('text=Mobile Apps')).toBeVisible();
    await expect(downloadSection.locator('text=Browser Extension')).toBeVisible();
    await expect(downloadSection.locator('text=VS Code Extension')).toBeVisible();
    await expect(downloadSection.locator('text=JetBrains Plugin')).toBeVisible();
    await expect(downloadSection.locator('text=Dev CLI')).toBeVisible();
    await expect(downloadSection.locator('text=MCP Server')).toBeVisible();
    await expect(downloadSection.locator('text=Cloud Platform')).toBeVisible();
  });

  test('copy command buttons work', async ({ page }) => {
    await page.goto('/');
    
    // Test CLI copy button - use first() in case there are multiple copy buttons
    const cliButton = page.locator('button:has-text("npm install -g @hanzo/dev")').first();
    await cliButton.click();
    
    // Check clipboard was written (button text changes)
    await expect(cliButton).toContainText('Copied!');
    
    // Wait for button to reset
    await page.waitForTimeout(2500);
    await expect(cliButton).toContainText('npm install -g @hanzo/dev');
  });

  test('navigation links work', async ({ page }) => {
    await page.goto('/');
    
    // Check header links specifically in the nav element to avoid footer duplicates
    const nav = page.locator('nav');
    await expect(nav.locator('a[href="https://docs.hanzo.ai"]')).toBeVisible();
    await expect(nav.locator('a[href="https://github.com/hanzoai"]')).toBeVisible();
    await expect(nav.locator('a[href="https://cloud.hanzo.ai/login"]')).toBeVisible();
  });

  test('quick start section displays correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check quick start section
    await expect(page.locator('text=Quick Start in 30 Seconds')).toBeVisible();
    
    // Check code block - use first() to handle multiple matches
    const codeBlock = page.locator('.code-block').first();
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('npm install -g @hanzo/dev');
    await expect(codeBlock).toContainText('dev login');
  });

  test('responsive design works', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Check mobile menu behavior
    const navLinks = page.locator('.nav-links');
    await expect(navLinks).toBeHidden();
    
    // Check cards stack on mobile
    const downloadGrid = page.locator('.download-grid');
    await expect(downloadGrid).toBeVisible();
  });
});

test.describe('Dev Landing Page', () => {
  test('has correct content', async ({ page }) => {
    await page.goto('/src/dev.html');
    
    // Check title
    await expect(page).toHaveTitle('Dev - Ship 100X Faster with Parallel AI Agents');
    
    // Check main heading - use first() in case there are multiple h1 elements
    await expect(page.locator('h1').first()).toContainText('Ship 100X Faster');
    
    // Check demo terminal
    const terminal = page.locator('.demo-terminal');
    await expect(terminal).toBeVisible();
    await expect(terminal).toContainText('dev enhance');
  });

  test('pricing cards are displayed', async ({ page }) => {
    await page.goto('/src/dev.html');
    
    // Check pricing cards
    const pricingCards = page.locator('.pricing-card');
    await expect(pricingCards).toHaveCount(3);
    
    // Check prices - scope to pricing cards to be more specific
    await expect(pricingCards.locator('text=$0/month').first()).toBeVisible();
    await expect(pricingCards.locator('text=$49/month').first()).toBeVisible();
    await expect(pricingCards.locator('text=$199/month').first()).toBeVisible();
  });

  test('subscribe buttons redirect correctly', async ({ page, context }) => {
    await page.goto('/src/dev.html');
    
    // Listen for new pages (popups/tabs)
    const pagePromise = context.waitForEvent('page');
    
    // Click subscribe button - use first() in case there are multiple subscribe buttons
    await page.locator('button:has-text("Start Pro Trial")').first().click();
    
    // Get the new page
    const newPage = await pagePromise;
    await newPage.waitForLoadState();
    
    // Check URL
    expect(newPage.url()).toContain('cloud.hanzo.ai/signup');
    expect(newPage.url()).toContain('plan=pro');
    expect(newPage.url()).toContain('product=dev');
  });
});