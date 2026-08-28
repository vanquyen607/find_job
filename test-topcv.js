const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();
  
  try {
    await page.goto('https://www.topcv.vn/tim-viec-lam-it?keyword=developer', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    await page.waitForTimeout(5000);
    
    const title = await page.title();
    console.log('Title:', title);
    
    const cf = title.includes('Cloudflare') || title.includes('Just a moment');
    console.log('Cloudflare:', cf);
    
    const jobCount = await page.evaluate(() => {
      return document.querySelectorAll('.job-item-default, .job-list-item, [class*="job-item"], .job-item').length;
    });
    console.log('Job items:', jobCount);
    
    if (jobCount === 0) {
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('Body text:', bodyText);
    }
  } catch(e) {
    console.log('Error:', e.message.substring(0, 200));
  }
  
  await browser.close();
  process.exit(0);
})();
