// CV upload -> profile extraction -> job matching.
// The file is processed in memory only and never stored on the server.
const mammoth = require('mammoth');
const { scrapeAll, LOCATIONS, matchesLocation, normalizeText } = require('./scrapers');

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Display terms; matching runs on diacritics-stripped text, so Vietnamese
// terms are matched by their normalized form automatically.
const SKILL_TERMS = [
  'Java', 'Python', 'JavaScript', 'TypeScript', 'PHP', 'C#', 'C++', 'Golang', 'Kotlin', 'Swift', 'Ruby', 'SQL', 'HTML', 'CSS',
  'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Spring', 'Spring Boot', 'Laravel', 'Django', 'Flask', '.NET', 'ASP.NET',
  'Flutter', 'React Native', 'Next.js', 'NestJS', 'WordPress',
  'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Oracle', 'SQL Server', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'Google Cloud',
  'Git', 'Linux', 'CI/CD', 'Microservices', 'REST API', 'GraphQL',
  'Excel', 'Power BI', 'SEO', 'Content Marketing', 'Digital Marketing', 'Facebook Ads', 'Google Ads',
  'Kế toán', 'Kiểm toán', 'Thuế', 'Nhân sự', 'Tuyển dụng', 'Logistics', 'Thu mua', 'Chăm sóc khách hàng', 'Bán hàng',
  'Thiết kế đồ họa', 'Photoshop', 'Illustrator', 'Figma', 'AutoCAD', 'Revit',
  'Tiếng Anh', 'Tiếng Nhật', 'Tiếng Hàn', 'Tiếng Trung'
];

// Role phrases, longest first at match time so "java developer" wins over
// the generic "developer".
const ROLE_TERMS = [
  'java developer', 'python developer', 'react developer', 'frontend developer', 'front-end developer',
  'backend developer', 'back-end developer', 'fullstack developer', 'full-stack developer',
  'mobile developer', 'ios developer', 'android developer', 'software engineer', 'web developer',
  'data analyst', 'data engineer', 'data scientist', 'devops engineer', 'qa engineer', 'qc engineer',
  'business analyst', 'product manager', 'project manager', 'ui ux designer', 'graphic designer',
  'marketing executive', 'marketing manager', 'content writer', 'seo executive',
  'sales executive', 'sales manager', 'accountant', 'tester',
  'kế toán trưởng', 'kế toán tổng hợp', 'kế toán',
  'nhân viên kinh doanh', 'nhân viên marketing', 'nhân viên nhân sự', 'nhân viên hành chính',
  'nhân viên bán hàng', 'nhân viên chăm sóc khách hàng', 'nhân viên thu mua', 'nhân viên logistics',
  'kỹ sư', 'thiết kế', 'developer', 'engineer'
];

const GENERIC_ROLES = new Set(['developer', 'engineer', 'kỹ sư', 'thiết kế', 'tester', 'accountant', 'kế toán']);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termRegex(term) {
  const t = escapeRegExp(normalizeText(term));
  return new RegExp(`(?:^|[^a-z0-9])${t}(?![a-z0-9])`, 'i');
}

// pdf.js (via pdfjs-dist) instead of pdf-parse: pdf-parse's bundled pdf.js
// is too old and fails on modern PDFs that use xref streams (Chrome,
// ReportLab, most current CV builders).
async function extractPdfText(buffer) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true
  }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '';
    let lastY = null;
    for (const item of tc.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out += `${line}\n`;
        line = '';
      }
      line += `${item.str} `;
      lastY = y;
    }
    out += `${line}\n`;
  }
  return out;
}

async function extractText(buffer, ext) {
  if (ext === '.pdf') {
    if (buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error('File không đúng định dạng PDF');
    }
    return extractPdfText(buffer);
  }
  // .docx is a zip archive
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new Error('File không đúng định dạng Word (.docx)');
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

function parseProfile(text) {
  const norm = normalizeText(text);

  const email = (text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [null])[0];
  const phoneMatch = text.match(/(?:\+?84|0)(?:[\s.]?\d){9,10}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[\s.]/g, '') : null;

  const skills = SKILL_TERMS.filter((term) => termRegex(term).test(norm));

  // Experience patterns run on the normalized text so they work whether or
  // not the CV uses Vietnamese diacritics ("4 năm kinh nghiệm" and
  // "4 nam kinh nghiem" both match).
  let experienceYears = null;
  const expPatterns = [
    /(?:kinh nghiem|experience)[^0-9]{0,40}(\d{1,2})\s*\+?\s*(?:nam|years?|yrs?)/,
    /(\d{1,2})\s*\+?\s*(?:nam|years?)\s*(?:of\s*)?(?:kinh nghiem|experience)/,
    /(\d{1,2})\s*\+?\s*(?:nam kinh nghiem|years of experience)/
  ];
  for (const re of expPatterns) {
    const m = norm.match(re);
    if (m) { experienceYears = Math.min(parseInt(m[1], 10), 40); break; }
  }

  // First location (in text order) whose aliases appear in the CV.
  let location = null;
  let locationPos = Infinity;
  for (const [slug, loc] of Object.entries(LOCATIONS)) {
    for (const alias of loc.aliases) {
      const idx = norm.indexOf(alias);
      if (idx !== -1 && idx < locationPos) {
        locationPos = idx;
        location = { slug, name: loc.name };
      }
    }
  }

  const roles = [...ROLE_TERMS]
    .sort((a, b) => b.length - a.length)
    .filter((role) => termRegex(role).test(norm))
    .slice(0, 5);

  return { email, phone, skills, experienceYears, location, roles };
}

function buildQueries(profile) {
  const queries = [];
  const topRole = profile.roles[0];
  const topSkill = profile.skills[0];

  if (topRole && GENERIC_ROLES.has(topRole.toLowerCase()) && topSkill) {
    queries.push(`${topSkill} ${topRole}`);
  } else if (topRole) {
    queries.push(topRole);
  }

  const used = queries.join(' ').toLowerCase();
  const secondSkill = profile.skills.find((s) => !used.includes(normalizeText(s)));
  if (secondSkill) queries.push(secondSkill);
  else if (profile.roles[1]) queries.push(profile.roles[1]);
  else if (topSkill && !queries.length) queries.push(topSkill);

  return [...new Set(queries)].slice(0, 2);
}

function scoreJob(job, profile) {
  const titleN = normalizeText(job.title);
  const hay = `${titleN} ${normalizeText(job.description)}`;
  const matched = [];
  let score = 0;

  for (const skill of profile.skills) {
    const re = termRegex(skill);
    if (re.test(titleN)) { score += 12; matched.push(skill); }
    else if (re.test(hay)) { score += 5; matched.push(skill); }
  }
  for (const role of profile.roles.slice(0, 3)) {
    if (termRegex(role).test(titleN)) score += 10;
  }
  if (profile.location && matchesLocation(job.location, LOCATIONS[profile.location.slug])) {
    score += 10;
  }
  return { score: Math.min(score, 100), matched: matched.slice(0, 6) };
}

async function matchJobsFromCv(profile) {
  const queries = buildQueries(profile);
  if (!queries.length) return { queries, jobs: [] };

  const byUrl = new Map();
  for (const q of queries) {
    const found = await scrapeAll(q, profile.location ? profile.location.slug : '');
    for (const job of found) {
      if (!byUrl.has(job.url)) byUrl.set(job.url, job);
    }
  }

  const scored = [...byUrl.values()]
    .map((job) => {
      const { score, matched } = scoreJob(job, profile);
      return { ...job, matchScore: score, matchedKeywords: matched };
    })
    .filter((job) => job.matchScore >= 10)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 40);

  return { queries, jobs: scored };
}

async function handleCvUpload({ filename, dataBase64 }) {
  const ext = (String(filename || '').toLowerCase().match(/\.(pdf|docx)$/) || [])[0];
  if (!ext) {
    const err = new Error('Chỉ hỗ trợ file PDF hoặc Word (.docx)');
    err.status = 400;
    throw err;
  }
  const raw = String(dataBase64 || '').replace(/^data:[^,]*,/, '');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
    const err = new Error('File rỗng hoặc vượt quá 5MB');
    err.status = 400;
    throw err;
  }

  const text = await extractText(buffer, ext);
  if (text.replace(/\s+/g, ' ').trim().length < 80) {
    const err = new Error('Không đọc được chữ trong file. Nếu CV là ảnh scan, hãy dùng bản PDF/Word có chữ.');
    err.status = 422;
    throw err;
  }

  const profile = parseProfile(text);
  const { queries, jobs } = await matchJobsFromCv(profile);
  if (!queries.length) {
    const err = new Error('Chưa nhận diện được kỹ năng hoặc chức danh trong CV. Thử CV có thêm phần kỹ năng/kinh nghiệm nhé.');
    err.status = 422;
    throw err;
  }
  return { profile, queries, jobs };
}

module.exports = { handleCvUpload, parseProfile, buildQueries, scoreJob, MAX_FILE_BYTES };
