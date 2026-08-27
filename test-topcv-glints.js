const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh'
  });

  const page = await context.newPage();

  // Test TopCV
  console.log('=== TopCV Test ===');
  try {
    await page.goto('https://www.topcv.vn', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Check if blocked
    const title = await page.title();
    console.log('Homepage title:', title);
    
    if (!title.includes('Cloudflare') && !title.includes('Attention')) {
      // Navigate to search
      await page.goto('https://www.topcv.vn/tim-viec-lam-python-developer', { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      await page.waitForTimeout(5000);
      
      const searchTitle = await page.title();
      console.log('Search title:', searchTitle);
      
      if (!searchTitle.includes('Cloudflare') && !searchTitle.includes('Attention')) {
        // Extract job data
        const jobs = await page.evaluate(() => {
          const items = document.querySelectorAll('.job-item-default, .job-list-item, [class*="job-item"]');
          return Array.from(items).slice(0, 3).map(item => ({
            html: item.innerHTML.substring(0, 2000),
            text: item.innerText
          }));
        });
        console.log('Jobs found:', jobs.length);
        jobs.forEach((j, i) => {
          console.log(`\n--- Job ${i+1} ---`);
          console.log('Text:', j.text.substring(0, 300));
        });
      }
    }
  } catch (e) {
    console.error('TopCV error:', e.message);
  }

  // Test Glints
  console.log('\n\n=== Glints Test ===');
  try {
    // Try different Glints URLs
    const glintsUrls = [
      'https://glints.com/vn/opportunities/jobs?keyword=Python&country=VN',
      'https://glints.com/vn/opportunities/jobs/explore?keyword=Python&country=VN',
      'https://glints.com/vn/opportunities/jobs?keyword=python'
    ];

    for (const url of glintsUrls) {
      console.log(`\nTrying: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      
      const title = await page.title();
      console.log('Title:', title);
      
      // Check for job cards
      const jobCount = await page.evaluate(() => {
        const selectors = [
          '[class*="job-card"]',
          '[class*="opportunity-card"]',
          'a[href*="/opportunities/jobs/"]',
          '.card'
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) return { selector: sel, count: els.length };
        }
        return null;
      });
      console.log('Job elements:', jobCount);
      
      if (jobCount && jobCount.count > 0) {
        // Get sample data
        const sample = await page.evaluate((sel) => {
          const items = document.querySelectorAll(sel);
          return Array.from(items).slice(0, 2).map(item => ({
            html: item.innerHTML.substring(0, 1500),
            text: item.innerText.substring(0, 500)
          }));
        }, jobCount.selector);
        console.log('Sample:', JSON.stringify(sample, null, 2));
        break;
      }
    }
  } catch (e) {
    console.error('Glints error:', e.message);
  }

  await browser.close();
})();
