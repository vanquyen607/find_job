const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Test CareerViet
  console.log('=== CareerViet ===');
  await page.goto('https://careerviet.vn/vi/tim-viec-lam', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());

  // Check for search input
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.name,
      type: i.type,
      id: i.id,
      placeholder: i.placeholder,
      class: i.className
    }));
  });
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  // Get job listings if any
  const jobElements = await page.evaluate(() => {
    const selectors = ['.job-item', '.result-item', '[class*="job"]', '.list-job .item', 'article'];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        return { selector: sel, count: els.length };
      }
    }
    return null;
  });
  console.log('Job elements:', jobElements);

  // Try TopCV
  console.log('\n=== TopCV ===');
  await page.goto('https://www.topcv.vn/tim-viec-lam-python-developer', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  const topcvBody = await page.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log('Body:', topcvBody.substring(0, 800));

  await browser.close();
})();
