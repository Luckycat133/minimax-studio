import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

page.on('response', res => {
  if (res.url().includes('/api/generate/image')) {
    console.log('Image API response:', res.status());
    res.text().then(body => console.log('  Body:', body.substring(0, 300))).catch(() => {});
  }
});

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });

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

  await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('button, li, div'));
    const imgEl = allEls.find(el => el.textContent.includes('图片生成'));
    if (imgEl) imgEl.click();
  });
  await new Promise(resolve => setTimeout(resolve, 2000));

  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.type('a beautiful mountain sunset with purple sky');
    
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const genBtn = btns.find(b => b.textContent.includes('开始生成'));
      if (genBtn) genBtn.click();
    });
    
    console.log('Waiting 25s for generation...');
    await new Promise(resolve => setTimeout(resolve, 25000));
    
    const result = await page.evaluate(() => {
      const toasts = Array.from(document.querySelectorAll('.toast')).map(t => t.textContent.trim());
      const errors = Array.from(document.querySelectorAll('[class*="error"]')).map(e => e.textContent.trim());
      const images = Array.from(document.querySelectorAll('img')).map(img => img.src.substring(0, 150));
      return { toasts, errors, images };
    });
    
    console.log('Toasts:', result.toasts);
    console.log('Errors:', result.errors);
    console.log('Images:', result.images);
  }

  await page.screenshot({ path: '/tmp/final_result.png', fullPage: false });
  console.log('Screenshot saved');

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
