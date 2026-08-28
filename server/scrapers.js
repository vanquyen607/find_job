const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { chromium: playwrightExtra } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin
playwrightExtra.use(StealthPlugin());

// ==================== CONFIG ====================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 }
];

// ==================== CACHE ====================
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCacheKey(keyword, platform) {
  return `${keyword.toLowerCase().trim()}-${platform || 'all'}`;
}

function getFromCache(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
  // Cleanup old entries periodically
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > CACHE_TTL) cache.delete(k);
    }
  }
}

// ==================== RETRY ====================
async function withRetry(fn, options = {}) {
  const { maxRetries = 2, delayMs = 1000, platform = 'unknown' } = options;
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        console.log(`[${platform}] Retry ${attempt + 1}/${maxRetries} after error: ${err.message}`);
        await delay(delayMs * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Random delay to simulate human behavior
function humanDelay() {
  return delay(1000 + Math.random() * 2000);
}

// ==================== METRICS ====================
const metrics = {
  requests: 0,
  errors: 0,
  cacheHits: 0,
  scrapeTimes: {},
  lastReset: Date.now()
};

function recordMetric(platform, duration, success) {
  if (!metrics.scrapeTimes[platform]) {
    metrics.scrapeTimes[platform] = { total: 0, count: 0, errors: 0 };
  }
  metrics.scrapeTimes[platform].total += duration;
  metrics.scrapeTimes[platform].count++;
  if (!success) metrics.scrapeTimes[platform].errors++;
  metrics.requests++;
  if (!success) metrics.errors++;
}

function getMetrics() {
  const avgTimes = {};
  for (const [platform, data] of Object.entries(metrics.scrapeTimes)) {
    avgTimes[platform] = {
      avgMs: Math.round(data.total / data.count),
      totalScrapes: data.count,
      errors: data.errors
    };
  }
  return {
    ...metrics,
    scrapeTimes: avgTimes,
    cacheSize: cache.size,
    uptime: Math.round((Date.now() - metrics.lastReset) / 1000)
  };
}

let browser = null;
let stealthBrowser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

// Stealth browser for Cloudflare-protected sites
async function getStealthBrowser() {
  if (!stealthBrowser || !stealthBrowser.isConnected()) {
    try {
      // Try system Chrome first (bypasses Cloudflare better)
      stealthBrowser = await chromium.launch({ 
        headless: true,
        channel: 'chrome',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
      console.log('[Browser] Launched with system Chrome');
    } catch (e) {
      // Fallback to bundled Chromium
      console.log('[Browser] Chrome not found, using bundled Chromium');
      stealthBrowser = await chromium.launch({ 
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
    }
  }
  return stealthBrowser;
}

// ==================== GET JOB DETAIL ====================
async function getJobDetail(job) {
  if (!job.url || job.platform === 'vietnamworks') return job;

  try {
    // Use stealth browser for TopCV (Cloudflare protected)
    const b = job.platform === 'topcv' ? await getStealthBrowser() : await getBrowser();
    const context = await b.newContext({
      userAgent: getRandomUA(),
      viewport: getRandomViewport(),
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh'
    });
    const page = await context.newPage();

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(job.platform === 'topcv' ? 2000 : 1500);

    const detail = await page.evaluate((platform) => {
      const get = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 20) return el.innerText.trim();
        }
        return '';
      };

      let description = '';
      let requirements = '';

      if (platform === 'careerviet') {
        description = get([
          '.job-description',
          '.description-content',
          '[class*="description"]'
        ]);
        requirements = get([
          '.job-requirement',
          '.requirement-content',
          '[class*="requirement"]'
        ]);
      } else if (platform === 'itviec') {
        description = get([
          '.job-description',
          '[class*="description"]',
          '.job-detail'
        ]);
      } else if (platform === 'glints') {
        description = get([
          '.job-description',
          '[class*="description"]',
          '.job-detail'
        ]);
      } else if (platform === 'topcv') {
        // TopCV has specific sections with headers
        const getAllText = () => {
          const mainEl = document.querySelector('#job-detail-content, .job-detail, main, .main-content');
          return mainEl ? mainEl.innerText : document.body.innerText;
        };
        
        const fullText = getAllText();
        
        // Extract sections by headers
        const extractSection = (startKeyword, endKeywords) => {
          const startIdx = fullText.indexOf(startKeyword);
          if (startIdx === -1) return '';
          
          let endIdx = fullText.length;
          for (const endKw of endKeywords) {
            const idx = fullText.indexOf(endKw, startIdx + startKeyword.length);
            if (idx !== -1 && idx < endIdx) endIdx = idx;
          }
          
          return fullText.substring(startIdx + startKeyword.length, endIdx).trim();
        };
        
        // Get description
        description = extractSection('Mô tả công việc', ['Yêu cầu ứng viên', 'Quyền lợi', 'Địa điểm']);
        
        // Get requirements
        requirements = extractSection('Yêu cầu ứng viên', ['Quyền lợi', 'Địa điểm', 'Cách thức']);
        
        // Get benefits
        const benefits = extractSection('Quyền lợi ứng viên', ['Địa điểm', 'Cách thức', 'Hạn ứng tuyển']);
        
        // Combine for full detail
        if (benefits) {
          description = description ? description + '\n\nQUYỀN LỢI:\n' + benefits : benefits;
        }
      }

      if (!description) {
        const main = document.querySelector('main') || document.querySelector('.main-content') || document.body;
        description = main.innerText.substring(0, 5000);
      }

      return {
        description: description.substring(0, 3000),
        requirements: requirements.substring(0, 2000)
      };
    }, job.platform);

    await context.close();

    if (detail.description) {
      job.description = detail.description;
    }
    if (detail.requirements) {
      job.requirements = detail.requirements;
    }
    console.log(`[Detail] Got description for: ${job.title.substring(0, 40)}... (${job.description.length} chars)`);
  } catch (e) {
    console.log(`[Detail] Failed for: ${job.title.substring(0, 40)}... (${e.message})`);
  }

  return job;
}

// Batch get details for multiple jobs
async function batchGetDetails(jobs, maxDetails = 5) {
  // Prioritize CareerViet (which we know works), then ITviec, skip Glints (403)
  const careervietJobs = jobs.filter(j => j.platform === 'careerviet' && j.description.length < 100);
  const itviecJobs = jobs.filter(j => j.platform === 'itviec' && j.description.length < 100);
  const otherJobs = jobs.filter(j => !['careerviet', 'itviec'].includes(j.platform) || j.description.length >= 100);
  
  const allPriorityJobs = [...careervietJobs, ...itviecJobs];
  const jobsWithDetails = [];
  let count = 0;

  // Fetch details for priority platforms
  for (const job of allPriorityJobs) {
    if (count >= maxDetails) break;
    console.log(`[Detail] Fetching detail for: ${job.title.substring(0, 50)}...`);
    const updated = await getJobDetail(job);
    jobsWithDetails.push(updated);
    count++;
    await delay(500);
  }

  // Add remaining jobs (VietnamWorks already has details, Glints skipped)
  for (const job of otherJobs) {
    if (!jobsWithDetails.find(j => j.url === job.url)) {
      jobsWithDetails.push(job);
    }
  }

  // Add remaining priority jobs that weren't fetched
  for (const job of allPriorityJobs) {
    if (!jobsWithDetails.find(j => j.url === job.url)) {
      jobsWithDetails.push(job);
    }
  }

  return jobsWithDetails;
}

// ==================== VIETNAMWORKS (API) ✅ ====================
async function scrapeVietnamWorks(keyword) {
  console.log('[VietnamWorks] Using API...');
  const jobs = [];

  try {
    const apiUrl = 'https://ms.vietnamworks.com/job-search/v1.0/search';
    const payload = {
      query: keyword,
      filter: [],
      ranges: [],
      order: [],
      hitsPerPage: 30,
      page: 0
    };

    const { data } = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': getRandomUA()
      },
      timeout: 15000
    });

    const items = data?.data || [];
    items.forEach(job => {
      let salary = 'Thương lượng';
      if (job.isSalaryVisible && job.salaryMin > 0) {
        salary = `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} VNĐ`;
      }

      const skills = (job.skills || []).map(s => s.skillName).join(', ');
      const desc = (job.jobDescription || '').replace(/<[^>]*>/g, '').substring(0, 500);
      const req = (job.jobRequirement || '').replace(/<[^>]*>/g, '').substring(0, 500);

      jobs.push({
        title: job.jobTitle || '',
        company: job.companyName || '',
        location: job.address || '',
        salary,
        experience: job.jobLevelId ? `Level ${job.jobLevelId}` : '',
        description: desc,
        requirements: req,
        skills,
        url: job.jobUrl || `https://www.vietnamworks.com/-i${job.jobId}.jv`,
        platform: 'vietnamworks'
      });
    });

    console.log(`[VietnamWorks] Found ${jobs.length} jobs`);
  } catch (e) {
    console.error('[VietnamWorks] Error:', e.message);
  }

  return jobs;
}

// ==================== GLINTS (HTML) ✅ ====================
async function scrapeGlints(keyword) {
  console.log('[Glints] Starting...');
  const jobs = [];

  try {
    const b = await getBrowser();
    const context = await b.newContext({
      userAgent: getRandomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'vi-VN'
    });
    const page = await context.newPage();

    const url = `https://glints.com/vn/opportunities/jobs?keyword=${encodeURIComponent(keyword)}&country=VN`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Extract job data from Glints
    const pageData = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="job-card"], [class*="opportunity-card"]');
      const results = [];

      items.forEach((item, i) => {
        if (i >= 30) return;

        // Title
        const titleEl = item.querySelector('h2 a, h3 a, [class*="JobTitle"] a');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const link = titleEl ? titleEl.href : '';

        // Salary
        const salaryEl = item.querySelector('[class*="Salary"], [class*="salary"]');
        let salary = salaryEl ? salaryEl.innerText.trim() : '';
        // Clean salary - remove job title prefix if duplicated
        if (salary.includes('\n')) {
          salary = salary.split('\n').find(s => s.includes('Tr') || s.includes('VND') || s.includes('Thương lượng') || s.match(/\d/)) || salary.split('\n')[0];
        }

        // Experience & Education from tags
        const tags = item.querySelectorAll('[class*="Tag"]');
        let experience = '';
        let education = '';
        let jobType = '';
        const skills = [];

        tags.forEach(tag => {
          const text = tag.innerText.trim();
          if (text.match(/\d+\s*-\s*\d+\s*năm|\d+\+?\s*năm|Không yêu cầu/i)) {
            experience = text;
          } else if (text.includes('Cao Đẳng') || text.includes('Đại Học') || text.includes('Cử Nhân')) {
            education = text;
          } else if (text.includes('fulltime') || text.includes('parttime') || text.includes('Thực tập')) {
            jobType = text;
          } else if (text.length > 2 && text.length < 50 && !text.includes('Premium')) {
            skills.push(text);
          }
        });

        // Company
        const companyEl = item.querySelector('[class*="Company"], [class*="company"]');
        const company = companyEl ? companyEl.innerText.trim() : '';

        // Location
        const locationEl = item.querySelector('[class*="Location"], [class*="location"]');
        const location = locationEl ? locationEl.innerText.trim() : '';

        // Posted time
        const timeEl = item.querySelector('[class*="time"], [class*="date"], [class*="Time"]');
        const posted = timeEl ? timeEl.innerText.trim() : '';

        if (title && title.length > 3) {
          results.push({
            title,
            company,
            location,
            salary,
            experience,
            education,
            jobType,
            skills: skills.join(', '),
            posted,
            link
          });
        }
      });

      return results;
    });

    pageData.forEach(job => {
      // Deduplicate skills
      const uniqueSkills = [...new Set(job.skills.split(', ').filter(s => s))];
      jobs.push({
        title: job.title,
        company: job.company || '',
        location: job.location || '',
        salary: job.salary || '',
        experience: job.experience || '',
        description: uniqueSkills.join(', '),
        url: job.link || '',
        platform: 'glints'
      });
    });

    await context.close();
    console.log(`[Glints] Found ${jobs.length} jobs`);
  } catch (e) {
    console.error('[Glints] Error:', e.message);
  }

  return jobs;
}

// ==================== TOPCV (Playwright) ====================
async function scrapeTopCV(keyword) {
  console.log('[TopCV] Starting with stealth bypass...');
  const jobs = [];

  try {
    // Try stealth browser first
    const b = await getStealthBrowser();
    const viewport = getRandomViewport();
    
    const context = await b.newContext({
      userAgent: getRandomUA(),
      viewport: viewport,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      extraHTTPHeaders: {
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      }
    });

    // Add init script to patch automation flags
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // First visit homepage to get cookies (like a real user)
    console.log('[TopCV] Visiting homepage...');
    await page.goto('https://www.topcv.vn', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay();

    // Check for Cloudflare challenge
    let pageTitle = await page.title();
    if (pageTitle.includes('Cloudflare') || pageTitle.includes('Attention') || pageTitle.includes('Just a moment')) {
      console.log('[TopCV] Cloudflare challenge detected, waiting...');
      await page.waitForTimeout(8000); // Wait for challenge to resolve
      pageTitle = await page.title();
    }

    // If still blocked, try alternative approach
    if (pageTitle.includes('Cloudflare') || pageTitle.includes('Attention')) {
      console.log('[TopCV] Still blocked, trying search page directly...');
      
      // Try Google cache or alternative
      const searchUrl = `https://www.topcv.vn/tim-viec-lam-${keyword.replace(/\s+/g, '-')}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay();
      
      pageTitle = await page.title();
      if (pageTitle.includes('Cloudflare') || pageTitle.includes('Attention')) {
        console.log('[TopCV] Blocked by Cloudflare - returning empty');
        await context.close();
        return jobs;
      }
    }

    // Navigate to search page with different URL patterns
    const searchUrls = [
      `https://www.topcv.vn/tim-viec-lam-${keyword.replace(/\s+/g, '-')}`,
      `https://www.topcv.vn/tim-viec-lam?keyword=${encodeURIComponent(keyword)}`,
      `https://www.topcv.vn/viec-lam?keyword=${encodeURIComponent(keyword)}`
    ];

    let pageLoaded = false;
    for (const searchUrl of searchUrls) {
      console.log(`[TopCV] Trying: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay();

      // Check if we got content
      const hasJobs = await page.evaluate(() => {
        return document.querySelectorAll('.job-item-default, .job-list-item, [class*="job-item"], .job-list-2, .job-item').length > 0;
      });

      if (hasJobs) {
        pageLoaded = true;
        console.log(`[TopCV] Success with URL: ${searchUrl}`);
        break;
      }
    }

    if (!pageLoaded) {
      console.log('[TopCV] No jobs found on any URL');
    }
    
    // Extract job data with more selectors
    const pageData = await page.evaluate(() => {
      // Try multiple selector patterns
      const selectors = [
        '.job-item-default',
        '.job-list-item', 
        '[class*="job-item"]',
        '.job-list-2 .job-item',
        '.job-item-2',
        'div[class*="JobItem"]'
      ];
      
      let items = [];
      for (const sel of selectors) {
        items = document.querySelectorAll(sel);
        if (items.length > 0) break;
      }

      const results = [];

      items.forEach((item, i) => {
        if (i >= 30) return;

        // Try multiple title selectors
        const titleSelectors = [
          '.title-block h3 a',
          'h3 a',
          'a[href*="viec-lam"]',
          '.job-title a',
          'a[class*="title"]'
        ];
        
        let titleEl = null;
        for (const sel of titleSelectors) {
          titleEl = item.querySelector(sel);
          if (titleEl) break;
        }
        
        const title = titleEl ? titleEl.innerText.trim() : '';
        const link = titleEl ? titleEl.href : '';

        // Company
        const companySelectors = [
          '.company-name',
          '.employer-name',
          '[class*="company"]',
          '[class*="employer"]',
          '.employer-info a'
        ];
        
        let companyEl = null;
        for (const sel of companySelectors) {
          companyEl = item.querySelector(sel);
          if (companyEl) break;
        }
        const company = companyEl ? companyEl.innerText.trim() : '';

        // Salary
        const salarySelectors = [
          '.salary',
          '[class*="salary"]',
          '[class*="luong"]',
          '.salary-value'
        ];
        
        let salaryEl = null;
        for (const sel of salarySelectors) {
          salaryEl = item.querySelector(sel);
          if (salaryEl) break;
        }
        const salary = salaryEl ? salaryEl.innerText.trim() : '';

        // Location
        const locationSelectors = [
          '.address',
          '.location',
          '[class*="location"]',
          '[class*="address"]'
        ];
        
        let locationEl = null;
        for (const sel of locationSelectors) {
          locationEl = item.querySelector(sel);
          if (locationEl) break;
        }
        const location = locationEl ? locationEl.innerText.trim() : '';

        // Experience
        const expSelectors = [
          '.experience',
          '[class*="experience"]',
          '[class*="kinh-nghiem"]'
        ];
        
        let expEl = null;
        for (const sel of expSelectors) {
          expEl = item.querySelector(sel);
          if (expEl) break;
        }
        const experience = expEl ? expEl.innerText.trim() : '';

        // Skills - use .item-tag for individual tags (TopCV specific)
        const skills = [];
        const seenSkills = new Set();
        
        // Helper to check if skill is duplicate
        const isDuplicate = (text) => {
          const lower = text.toLowerCase();
          if (seenSkills.has(lower)) return true;
          // Check if it's a prefix/suffix of existing skill
          for (const seen of seenSkills) {
            if (lower.startsWith(seen) || seen.startsWith(lower)) return true;
            if (lower.substring(0, 10) === seen.substring(0, 10) && lower.length > 10) return true;
          }
          return false;
        };
        
        // First try .item-tag (TopCV individual tags)
        item.querySelectorAll('.item-tag').forEach(s => {
          let text = s.innerText.trim();
          // Clean up text
          text = text.replace(/\+\d+$/, '').trim();
          if (text && text.length < 40 && text.length > 3 && !isDuplicate(text)) {
            seenSkills.add(text.toLowerCase());
            skills.push(text);
          }
        });
        
        // Fallback to other selectors if no .item-tag found
        if (skills.length === 0) {
          ['.skill-tag', '.tag-item', '.badge-tag'].forEach(sel => {
            item.querySelectorAll(sel).forEach(s => {
              let text = s.innerText.trim();
              text = text.replace(/\+\d+$/, '').trim();
              if (text && text.length < 40 && text.length > 3 && !isDuplicate(text)) {
                seenSkills.add(text.toLowerCase());
                skills.push(text);
              }
            });
          });
        }

        // Limit to 4 skills max
        const limitedSkills = skills.slice(0, 4);

        if (title && title.length > 3) {
          results.push({ title, company, salary, location, experience, skills: limitedSkills.join(', '), link });
        }
      });

      return results;
    });

    pageData.forEach(job => {
      jobs.push({
        title: job.title,
        company: job.company || '',
        location: job.location || '',
        salary: job.salary || '',
        experience: job.experience || '',
        description: job.skills,
        url: job.link || '',
        platform: 'topcv'
      });
    });

    await context.close();
    console.log(`[TopCV] Found ${jobs.length} jobs`);
  } catch (e) {
    console.error('[TopCV] Error:', e.message);
  }

  return jobs;
}

// ==================== CAREERVIET (HTML) ✅ ====================
async function scrapeCareerViet(keyword) {
  console.log('[CareerViet] Starting...');
  const jobs = [];

  try {
    // Try multiple URL patterns
    const urls = [
      `https://careerviet.vn/viec-lam/${keyword.replace(/\s+/g, '-').toLowerCase()}-k-vi.html`,
      `https://careerviet.vn/viec-lam/${keyword.split(' ')[0].toLowerCase()}-k-vi.html`,
      `https://careerviet.vn/viec-lam/tat-ca-viec-lam-vi.html`
    ];

    for (const url of urls) {
      try {
        const { data: html } = await axios.get(url, {
          headers: { 'User-Agent': getRandomUA() },
          timeout: 15000
        });

        const $ = cheerio.load(html);

        $('.job-item').each((i, el) => {
          if (jobs.length >= 30) return false;

          const titleEl = $(el).find('.title a.job_link').first();
          const title = titleEl.text().trim();
          const link = titleEl.attr('href');

          const companyEl = $(el).find('.company-name').first();
          const company = companyEl.text().trim();

          const salaryEl = $(el).find('.salary p').first();
          let salary = salaryEl.text().trim().replace('Luong: ', '').trim();

          const locationEl = $(el).find('.location li').first();
          const location = locationEl.text().trim();

          if (title && title.length > 3) {
            jobs.push({
              title,
              company: company || '',
              location: location || '',
              salary: salary || '',
              experience: '',
              description: '',
              url: link ? (link.startsWith('http') ? link : `https://careerviet.vn${link}`) : '',
              platform: 'careerviet'
            });
          }
        });

        if (jobs.length >= 5) break;
      } catch (e) {
        // Try next URL
      }
    }

    console.log(`[CareerViet] Found ${jobs.length} jobs`);
  } catch (e) {
    console.error('[CareerViet] Error:', e.message);
  }

  return jobs;
}

// ==================== ITVIC (Playwright) ✅ ====================
async function scrapeITviec(keyword) {
  console.log('[ITviec] Starting...');
  const jobs = [];

  try {
    const b = await getBrowser();
    const context = await b.newContext({
      userAgent: getRandomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'vi-VN'
    });
    const page = await context.newPage();

    const url = `https://itviec.com/it-jobs/${keyword.replace(/\s+/g, '-')}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const pageData = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="job-card"], [data-job-id]');
      const results = [];

      items.forEach((item, i) => {
        if (i >= 30) return;

        const titleEl = item.querySelector('h3 a, h2 a, a[href*="/it-jobs/"]');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const link = titleEl ? titleEl.href : '';

        const companyEl = item.querySelector('[class*="company"], [class*="employer"]');
        const company = companyEl ? companyEl.innerText.trim() : '';

        const locationEl = item.querySelector('[class*="city"], [class*="location"], .text-muted');
        const location = locationEl ? locationEl.innerText.trim() : '';

        const salaryEl = item.querySelector('[class*="salary"], [class*="Salary"]');
        const salary = salaryEl ? salaryEl.innerText.trim() : '';

        const expEl = item.querySelector('[class*="experience"], [class*="level"]');
        const experience = expEl ? expEl.innerText.trim() : '';

        const skills = [];
        item.querySelectorAll('[class*="skill"], [class*="tag"]').forEach(s => {
          const text = s.innerText.trim();
          if (text && text.length < 50 && !text.includes('ago')) skills.push(text);
        });

        if (title && title.length > 3) {
          results.push({
            title,
            company,
            location,
            salary: salary || 'Thương lượng',
            experience,
            skills: [...new Set(skills)].join(', '),
            link
          });
        }
      });

      return results;
    });

    pageData.forEach(job => {
      jobs.push({
        title: job.title,
        company: job.company || '',
        location: job.location || '',
        salary: job.salary || 'Thương lượng',
        experience: job.experience || '',
        description: job.skills || '',
        url: job.link || '',
        platform: 'itviec'
      });
    });

    await context.close();
    console.log(`[ITviec] Found ${jobs.length} jobs`);
  } catch (e) {
    console.error('[ITviec] Error:', e.message);
  }

  return jobs;
}

// ==================== CLEAN & DEDUPLICATE ====================
function cleanAndDeduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    job.title = job.title.replace(/\s+/g, ' ').trim();
    job.company = job.company.replace(/\s+/g, ' ').trim();

    const key = `${job.title.toLowerCase()}-${job.company.toLowerCase()}-${job.platform}`;
    if (seen.has(key)) return false;
    seen.add(key);

    return job.title && job.title.length > 2;
  });
}

// ==================== SCRAPE ALL ====================
function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms)
    )
  ]);
}

async function scrapeAll(keyword) {
  console.log(`\n[SCRAPE] ========== Searching: "${keyword}" ==========\n`);
  
  // Check cache first
  const cacheKey = getCacheKey(keyword);
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[SCRAPE] Cache hit for "${keyword}"`);
    metrics.cacheHits++;
    return cached;
  }

  const SCRAPE_TIMEOUT = parseInt(process.env.SCRAPE_TIMEOUT) || 40000;
  const MAX_JOBS_PER_PLATFORM = parseInt(process.env.MAX_JOBS_PER_PLATFORM) || 20;
  
  // HTTP-only scrapers work everywhere; Playwright scrapers need more RAM
  const httpScrapers = [
    { name: 'VietnamWorks', fn: scrapeVietnamWorks },
    { name: 'CareerViet', fn: scrapeCareerViet }
  ];
  
  const browserScrapers = [
    { name: 'Glints', fn: scrapeGlints },
    { name: 'ITviec', fn: scrapeITviec },
    { name: 'TopCV', fn: scrapeTopCV }
  ];

  const allScrapers = [...httpScrapers, ...browserScrapers];
  const results = [];

  // Run HTTP scrapers in parallel (lightweight)
  console.log('[SCRAPE] Running HTTP scrapers...');
  const httpResults = await Promise.allSettled(
    httpScrapers.map(async (scraper) => {
      const startTime = Date.now();
      try {
        const jobs = await withTimeout(
          scraper.fn(keyword),
          SCRAPE_TIMEOUT,
          scraper.name
        );
        recordMetric(scraper.name, Date.now() - startTime, true);
        const limited = jobs.slice(0, MAX_JOBS_PER_PLATFORM);
        console.log(`[${scraper.name}] OK: ${limited.length} jobs in ${Date.now() - startTime}ms`);
        return { name: scraper.name, jobs: limited };
      } catch (err) {
        recordMetric(scraper.name, Date.now() - startTime, false);
        console.error(`[${scraper.name}] Failed: ${err.message}`);
        return { name: scraper.name, jobs: [] };
      }
    })
  );
  results.push(...httpResults);

  // Run browser scrapers ONE BY ONE (save RAM), close browser between each
  console.log('[SCRAPE] Running browser scrapers (sequential)...');
  for (const scraper of browserScrapers) {
    // Check memory before each browser scraper
    const memUsed = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`[${scraper.name}] Memory: ${Math.round(memUsed)}MB used`);
    
    if (memUsed > 400) {
      console.error(`[${scraper.name}] Skipped - too much memory used`);
      results.push({ status: 'fulfilled', value: { name: scraper.name, jobs: [] } });
      continue;
    }
    
    const startTime = Date.now();
    try {
      const jobs = await withTimeout(
        scraper.fn(keyword),
        SCRAPE_TIMEOUT,
        scraper.name
      );
      const limited = jobs.slice(0, MAX_JOBS_PER_PLATFORM);
      recordMetric(scraper.name, Date.now() - startTime, true);
      console.log(`[${scraper.name}] OK: ${limited.length} jobs in ${Date.now() - startTime}ms`);
      results.push({ status: 'fulfilled', value: { name: scraper.name, jobs: limited } });
    } catch (err) {
      recordMetric(scraper.name, Date.now() - startTime, false);
      console.error(`[${scraper.name}] Failed: ${err.message}`);
      results.push({ status: 'fulfilled', value: { name: scraper.name, jobs: [] } });
    }
    
    // Close browser to free memory before next scraper
    await closeBrowser();
  }

  let allJobs = [];
  const sources = {};

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const { name, jobs } = result.value;
      sources[name] = jobs.length;
      allJobs = allJobs.concat(jobs);
    }
  });

  const cleaned = cleanAndDeduplicate(allJobs);

  // Fetch details for jobs without description (max 10 jobs to avoid timeout)
  console.log('[SCRAPE] Fetching job details...');
  console.log(`[SCRAPE] Jobs to process: ${cleaned.length}`);
  const withDetails = await batchGetDetails(cleaned, 5);
  console.log(`[SCRAPE] Jobs after detail fetch: ${withDetails.length}`);

  console.log('\n[SCRAPE] ========== Results ==========');
  console.log('[SCRAPE] Sources:', sources);
  console.log(`[SCRAPE] Total: ${allJobs.length} → Cleaned: ${cleaned.length}`);
  console.log('[SCRAPE] =================================\n');

  // Cache the results
  setCache(cacheKey, withDetails);

  return withDetails;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
  if (stealthBrowser) {
    await stealthBrowser.close();
    stealthBrowser = null;
  }
}

// Scrape job detail by URL (for API endpoint)
async function scrapeJobDetail(url, platform) {
  const job = { url, platform, title: '', company: '', description: '', requirements: '' };
  return await getJobDetail(job);
}

module.exports = { scrapeAll, closeBrowser, getJobDetail, scrapeJobDetail, getMetrics };
