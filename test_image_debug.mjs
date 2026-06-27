import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();

// Capture all network requests and responses
page.on('request', req => {
  if (req.url().includes('/api/')) {
    console.log('REQUEST:', req.method(), req.url());
    console.log('  Headers:', JSON.stringify(req.headers()));
  }
});

page.on('response', res => {
  if (res.url().includes('/api/')) {
    console.log('RESPONSE:', res.status(), res.url());
    res.text().then(body => {
      console.log('  Body:', body.substring(0, 200));
    }).catch(() => {});
  }
});

page.on('requestfailed', req => {
  console.log('FAILED:', req.method(), req.url(), req.failure()?.error);
});

await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });

// Login
await page.evaluate(() => {
  const emailInput = document.querySelector('input[type="email"], input[name="email"]');
  const passInput = document.querySelector('input[type="password"]');
  if (emailInput && passInput) {
    emailInput.value = 'finntest@test.com';
    passInput.value = 'TestPass123!@#';
    const form = document.querySelector('form');
    if (form) form.dispatchEvent(new Event('submit'));
  }
});
await new Promise(resolve => setTimeout(resolve, 3000));

// Click image tab
await page.evaluate(() => {
  const allEls = Array.from(document.querySelectorAll('button, li, div'));
  const imgEl = allEls.find(el => el.textContent.includes('图片生成'));
  if (imgEl) imgEl.click();
});
await new Promise(resolve => setTimeout(resolve, 2000));

// Fill prompt and generate
const textarea = await page.$('textarea');
if (textarea) {
  await textarea.type('a beautiful mountain sunset');
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const genBtn = btns.find(b => b.textContent.includes('开始生成'));
    if (genBtn) genBtn.click();
  });
  
  console.log('Waiting for response...');
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  const result = await page.evaluate(() => {
    const errors = Array.from(document.querySelectorAll('[class*="error"]')).map(e => e.textContent.trim());
    return { errors };
  });
  console.log('Final errors:', result.errors);
}

await page.screenshot({ path: '/tmp/debug_result.png', fullPage: false });
console.log('Screenshot saved');

await browser.close();
