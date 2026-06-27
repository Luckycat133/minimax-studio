import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

console.log('Opening MiniMax Studio...');
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

// Check if login form is present
const loginForm = await page.$('form');
if (loginForm) {
  console.log('Login form found, logging in...');
  await page.type('input[type="email"]', 'finntest@test.com');
  await page.type('input[type="password"]', 'TestPass123!@#');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
}

console.log('Page title:', await page.title());
console.log('Current URL:', page.url());

// Check if sidebar has music option
const musicBtn = await page.$('text=音乐生成');
console.log('Music button found:', !!musicBtn);

// Click on music generation
if (musicBtn) {
  await musicBtn.click();
  await page.waitForTimeout(1000);
  console.log('Clicked music button');
}

// Check for model selector
const modelSelect = await page.$('#model-select, [id*="model"], select');
console.log('Model select found:', !!modelSelect);

await browser.close();
console.log('Test completed');
