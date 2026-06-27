import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

try {
  console.log('Opening page');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });
  console.log('Title:', await page.title());

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
  console.log('After login:', page.url());

  await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('button, li, div'));
    const imgEl = allEls.find(el => el.textContent.includes('图片生成'));
    if (imgEl) imgEl.click();
  });
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('Clicked image tab');

  const state = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().substring(0, 40));
    return btns;
  });
  console.log('Buttons:', state);

  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.type('a beautiful mountain sunset');
    console.log('Filled prompt');
    
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const genBtn = btns.find(b => b.textContent.includes('开始生成'));
      if (genBtn) genBtn.click();
    });
    console.log('Clicked generate');
    
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    const result = await page.evaluate(() => {
      const errors = Array.from(document.querySelectorAll('[class*="error"]')).map(e => e.textContent.trim().substring(0, 100));
      const images = Array.from(document.querySelectorAll('img')).map(img => img.src.substring(0, 100));
      return { errors, images };
    });
    
    console.log('Errors:', result.errors);
    console.log('Images:', result.images);
  } else {
    console.log('No textarea found');
  }

  await page.screenshot({ path: '/tmp/test_result.png', fullPage: false });
  console.log('Done, screenshot saved');

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
