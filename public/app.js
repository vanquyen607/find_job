'use strict';

const API_BASE = window.location.origin;

const PLATFORM_META = {
  vietnamworks: { name: 'VietnamWorks', color: '#1d4ed8' },
  careerviet: { name: 'CareerViet', color: '#15803d' },
  itviec: { name: 'ITviec', color: '#b45309' },
  glints: { name: 'Glints', color: '#0e7490' },
  topcv: { name: 'TopCV', color: '#b91c1c' }
};
const PLATFORM_ORDER = ['vietnamworks', 'careerviet', 'itviec', 'glints', 'topcv'];
const MAX_COMPARE = 4;
const VISIBLE_PER_PLATFORM = 6;
const RECENT_SEARCH_LIMIT = 6;

const state = {
  jobs: [],
  filtered: [],
  compare: [],
  savedJobIds: new Set(),
  savedJobs: [],
  expandedPlatforms: new Set(),
  collapsedPlatforms: new Set(),
  recentSearches: loadRecentSearches(),
  searchController: null,
  lastQuery: '',
  loadTimeMs: null
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  const toastRegion = document.getElementById('toast-region');
  if (toastRegion) document.body.appendChild(toastRegion);
  bindGlobalEvents();
  loadSavedJobs();
  renderRecentSearches();
}

function cacheElements() {
  els.searchInput = document.getElementById('search-input');
  els.searchBtn = document.getElementById('search-btn');
  els.btnText = els.searchBtn?.querySelector('.btn-text');
  els.btnSpinner = els.searchBtn?.querySelector('.btn-spinner');
  els.resultsContainer = document.getElementById('results-container');
  els.resultsHeader = document.getElementById('results-header');
  els.searchQuery = document.getElementById('search-query');
  els.resultCount = document.getElementById('result-count');
  els.loadTime = document.getElementById('load-time');
  els.loading = document.getElementById('loading');
  els.errorMessage = document.getElementById('error-message');
  els.errorText = document.getElementById('error-text');
  els.emptyState = document.getElementById('empty-state');
  els.totalJobs = document.getElementById('total-jobs');
  els.filterBar = document.getElementById('filter-bar');
  els.sortSelect = document.getElementById('sort-select');
  els.progressBar = document.getElementById('progress-bar');
  els.progressFill = document.getElementById('progress-fill');
  els.progressText = document.getElementById('progress-text');
  els.recentSearches = document.getElementById('recent-searches');
  els.savedModal = document.getElementById('saved-jobs-modal');
  els.savedList = document.getElementById('saved-jobs-list');
  els.compareModal = document.getElementById('compare-modal');
  els.compareTable = document.getElementById('compare-table');
  els.srStatus = document.getElementById('sr-status');
  els.mobileBtn = document.getElementById('mobile-menu-btn');
  els.mobileOverlay = document.getElementById('mobile-overlay');
  els.mobileDrawer = document.getElementById('mobile-drawer');
}

// ==================== HELPERS ====================

function loadRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem('recentSearches') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 100))
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentSearches() {
  try {
    localStorage.setItem('recentSearches', JSON.stringify(state.recentSearches));
  } catch {
    /* storage unavailable */
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function safeHttpUrl(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function platformName(platform) {
  return PLATFORM_META[platform]?.name || String(platform || '').toUpperCase();
}

function platformColor(platform) {
  return PLATFORM_META[platform]?.color || '#4f46e5';
}

function announce(message) {
  if (els.srStatus) els.srStatus.textContent = message;
}

function showToast(message, type = 'info') {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ==================== NAVIGATION ====================

function openMobileMenu() {
  els.mobileBtn?.classList.add('open');
  els.mobileOverlay?.classList.add('open');
  els.mobileDrawer?.classList.add('open');
  els.mobileDrawer?.setAttribute('aria-hidden', 'false');
  els.mobileBtn?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}

function closeMobileMenu() {
  els.mobileBtn?.classList.remove('open');
  els.mobileOverlay?.classList.remove('open');
  els.mobileDrawer?.classList.remove('open');
  els.mobileDrawer?.setAttribute('aria-hidden', 'true');
  els.mobileBtn?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

function toggleMobileMenu() {
  if (els.mobileDrawer?.classList.contains('open')) closeMobileMenu();
  else openMobileMenu();
}

// ==================== RECENT SEARCHES ====================

function addRecentSearch(query) {
  if (!query) return;
  state.recentSearches = [query, ...state.recentSearches.filter((item) => item !== query)]
    .slice(0, RECENT_SEARCH_LIMIT);
  persistRecentSearches();
  renderRecentSearches();
}

function renderRecentSearches() {
  if (!els.recentSearches) return;
  els.recentSearches.innerHTML = '';

  if (state.recentSearches.length === 0) {
    els.recentSearches.hidden = true;
    return;
  }

  els.recentSearches.hidden = false;
  const label = document.createElement('span');
  label.className = 'tag-label';
  label.textContent = 'Tìm gần đây:';
  els.recentSearches.appendChild(label);

  state.recentSearches.forEach((query) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag tag-recent';
    chip.dataset.query = query;
    chip.textContent = query;
    els.recentSearches.appendChild(chip);
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'recent-clear';
  clear.dataset.action = 'clear-recent';
  clear.textContent = 'Xóa';
  clear.setAttribute('aria-label', 'Xóa lịch sử tìm kiếm gần đây');
  els.recentSearches.appendChild(clear);
}

// ==================== SEARCH ====================

async function performSearch(rawQuery) {
  const query = String(rawQuery ?? els.searchInput?.value ?? '').replace(/\s+/g, ' ').trim();

  if (query.length < 2) {
    showToast('Vui lòng nhập ít nhất 2 ký tự', 'error');
    els.searchInput?.focus();
    return;
  }

  if (state.searchController) state.searchController.abort();
  const controller = new AbortController();
  state.searchController = controller;
  state.lastQuery = query;
  if (els.searchInput) els.searchInput.value = query;

  addRecentSearch(query);
  setLoading(true);
  resetCompare();
  showSkeletons();
  showProgress();

  const startTime = Date.now();

  try {
    const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Có lỗi xảy ra khi tìm kiếm');
    }

    if (state.searchController !== controller) return;

    state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
    state.loadTimeMs = Number(data.duration) || Date.now() - startTime;
    state.expandedPlatforms.clear();
    state.collapsedPlatforms.clear();

    hideProgress();
    applyFilters();
    refreshSaveButtons();
    scrollToResults();
  } catch (err) {
    if (err.name === 'AbortError') return;
    hideProgress();
    const message = err instanceof TypeError
      ? 'Không thể kết nối tới máy chủ, vui lòng thử lại'
      : (err.message || 'Không thể kết nối tới máy chủ');
    showError(message);
  } finally {
    if (state.searchController === controller) {
      state.searchController = null;
      setLoading(false);
    }
  }
}

function setLoading(isLoading) {
  if (els.searchBtn) els.searchBtn.disabled = isLoading;
  els.btnText?.classList.toggle('hidden', isLoading);
  els.btnSpinner?.classList.toggle('hidden', !isLoading);
  els.resultsContainer?.setAttribute('aria-busy', String(isLoading));
}

function scrollToResults() {
  if (!els.resultsHeader) return;
  const top = els.resultsHeader.getBoundingClientRect().top;
  if (top < 120) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({
    top: window.scrollY + top - 96,
    behavior: reduceMotion ? 'auto' : 'smooth'
  });
}

function showSkeletons() {
  hideAll();
  if (!els.resultsContainer) return;
  els.resultsContainer.innerHTML = Array.from({ length: 6 }, () => (
    '<div class="skeleton skeleton-card" aria-hidden="true"></div>'
  )).join('');
}

let progressTimer = null;
let progressHideTimer = null;

function showProgress() {
  if (!els.progressBar) return;
  clearTimeout(progressHideTimer);
  els.progressBar.classList.remove('hidden');
  if (els.progressFill) els.progressFill.style.width = '8%';
  if (els.progressText) els.progressText.textContent = 'Đang tìm kiếm trên các nền tảng...';

  let progress = 8;
  const startedAt = Date.now();
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    progress = Math.min(90, progress + Math.random() * 12);
    if (els.progressFill) els.progressFill.style.width = `${progress}%`;
    if (els.progressText) {
      if (Date.now() - startedAt > 8000) {
        els.progressText.textContent = 'Một số nền tảng phản hồi chậm, vẫn đang tìm thêm...';
      } else if (progress > 45) {
        els.progressText.textContent = 'Đang tổng hợp và loại bỏ trùng lặp...';
      }
    }
  }, 700);
}

function hideProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  if (els.progressFill) els.progressFill.style.width = '100%';
  if (els.progressText) els.progressText.textContent = 'Hoàn thành!';
  clearTimeout(progressHideTimer);
  progressHideTimer = setTimeout(() => els.progressBar?.classList.add('hidden'), 450);
}

// ==================== FILTERS & RENDERING ====================

function applyFilters() {
  const selectedPlatforms = Array.from(document.querySelectorAll('.filter-checkbox input:checked'))
    .map((cb) => cb.value);

  const salaryFilter = document.getElementById('salary-filter')?.value || '';
  const experienceFilter = document.getElementById('experience-filter')?.value || '';
  const locationFilter = document.getElementById('location-filter')?.value || '';
  const sortBy = els.sortSelect?.value || 'relevance';

  let jobs = state.jobs.slice();

  if (selectedPlatforms.length > 0) {
    jobs = jobs.filter((job) => selectedPlatforms.includes(job.platform));
  }

  if (salaryFilter) {
    jobs = jobs.filter((job) => {
      const { min, max } = parseSalary(job.salary);
      if (salaryFilter === '30+') return max >= 30;
      const [rangeMin, rangeMax] = salaryFilter.split('-').map(Number);
      if (!min && !max) return false;
      return max >= rangeMin && min <= rangeMax;
    });
  }

  if (experienceFilter) {
    jobs = jobs.filter((job) => {
      const years = parseExperienceYears(job.experience);
      const text = String(job.experience || '').toLowerCase();
      if (experienceFilter === 'fresher') {
        return years === 0 && (text.includes('fresher') || text.includes('thực tập')
          || text.includes('mới') || text.includes('không yêu cầu') || text.includes('dưới 1'));
      }
      if (experienceFilter === '1-2') return years >= 1 && years <= 2;
      if (experienceFilter === '3-5') return years >= 3 && years <= 5;
      if (experienceFilter === '5+') return years >= 5;
      return true;
    });
  }

  if (locationFilter) {
    jobs = jobs.filter((job) => {
      const loc = String(job.location || '').toLowerCase();
      const isHanoi = loc.includes('hà nội') || loc.includes('ha noi');
      const isHcm = loc.includes('hồ chí minh') || loc.includes('ho chi minh') || loc.includes('hcm');
      const isDanang = loc.includes('đà nẵng') || loc.includes('da nang');
      if (locationFilter === 'ha-noi') return isHanoi;
      if (locationFilter === 'hcm') return isHcm;
      if (locationFilter === 'da-nang') return isDanang;
      if (locationFilter === 'other') return !isHanoi && !isHcm && !isDanang;
      return true;
    });
  }

  state.filtered = sortJobs(jobs, sortBy);
  renderResults();
  updateTotalJobs();
}

function parseSalary(salary) {
  const text = String(salary || '').toLowerCase();
  if (!text || text.includes('thương lượng') || text.includes('thỏa thuận')) {
    return { min: 0, max: 0 };
  }

  const cleaned = text.replace(/(\d)[.,](?=\d{3}(?:\D|$))/g, '$1');
  const numbers = [...cleaned.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (numbers.length === 0) return { min: 0, max: 0 };

  let min = Math.min(...numbers);
  let max = Math.max(...numbers);

  if (!text.includes('triệu') && max > 1000) {
    min /= 1e6;
    max /= 1e6;
  }

  return { min, max };
}

function parseExperienceYears(experience) {
  const text = String(experience || '').toLowerCase();
  if (!text) return 0;
  if (text.includes('fresher') || text.includes('thực tập') || text.includes('không yêu cầu')
    || text.includes('dưới 1') || text.includes('< 1')) return 0;
  const numbers = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (numbers.length === 0) return 0;
  return Math.min(...numbers);
}

function sortJobs(jobs, sortBy) {
  const sorted = jobs.slice();
  switch (sortBy) {
    case 'salary-desc':
      sorted.sort((a, b) => parseSalary(b.salary).max - parseSalary(a.salary).max);
      break;
    case 'salary-asc':
      sorted.sort((a, b) => parseSalary(a.salary).min - parseSalary(b.salary).min);
      break;
    case 'platform':
      sorted.sort((a, b) => platformName(a.platform).localeCompare(platformName(b.platform), 'vi'));
      break;
    default:
      break;
  }
  return sorted;
}

function updateTotalJobs() {
  if (els.totalJobs) els.totalJobs.textContent = String(state.jobs.length);
}

function renderResults() {
  hideAll();

  if (!els.resultsContainer) return;

  const jobs = state.filtered;

  if (jobs.length === 0) {
    renderEmptyState();
    return;
  }

  if (els.resultsHeader) els.resultsHeader.classList.remove('hidden');
  if (els.searchQuery) els.searchQuery.textContent = state.lastQuery;
  if (els.resultCount) els.resultCount.textContent = String(jobs.length);
  if (els.loadTime && state.loadTimeMs) {
    els.loadTime.textContent = `· ${(state.loadTimeMs / 1000).toFixed(1)}s`;
  }

  const grouped = new Map();
  jobs.forEach((job) => {
    const key = PLATFORM_ORDER.includes(job.platform) ? job.platform : 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(job);
  });

  const sections = [];
  PLATFORM_ORDER.forEach((platform) => {
    const platformJobs = grouped.get(platform);
    if (!platformJobs || platformJobs.length === 0) return;
    sections.push(renderPlatformSection(platform, platformJobs));
  });
  if (grouped.has('other')) {
    sections.push(renderPlatformSection('other', grouped.get('other')));
  }

  els.resultsContainer.innerHTML = sections.join('');
  announce(`Tìm thấy ${jobs.length} việc làm cho ${state.lastQuery}`);
}

function renderPlatformSection(platform, jobs) {
  const expanded = state.expandedPlatforms.has(platform);
  const visible = expanded ? jobs : jobs.slice(0, VISIBLE_PER_PLATFORM);
  const hiddenCount = jobs.length - visible.length;
  const color = platformColor(platform);
  const name = platformName(platform);
  const isCollapsed = state.collapsedPlatforms.has(platform);

  const moreButton = hiddenCount > 0
    ? `<button type="button" class="btn-show-more" data-action="show-more" data-platform="${escapeHtml(platform)}">Xem thêm ${hiddenCount} việc</button>`
    : (expanded && jobs.length > VISIBLE_PER_PLATFORM
      ? `<button type="button" class="btn-show-more" data-action="collapse-platform" data-platform="${escapeHtml(platform)}">Thu gọn</button>`
      : '');

  return `
    <div class="platform-section" data-platform="${escapeHtml(platform)}" data-collapsed="${isCollapsed}">
      <h3 class="platform-title">
        <button type="button" class="platform-toggle" data-action="toggle-platform" data-platform="${escapeHtml(platform)}" aria-expanded="${!isCollapsed}">
          <span class="platform-badge" style="background: ${color}1a; color: ${color}">
            ${escapeHtml(name)}
          </span>
          <span class="platform-count">${jobs.length} việc</span>
          <svg class="platform-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </h3>
      <div class="platform-jobs${isCollapsed ? ' hidden' : ''}">
        ${visible.map((job) => createJobCard(job)).join('')}
      </div>
      ${moreButton && !isCollapsed ? `<div class="platform-more">${moreButton}</div>` : ''}
    </div>
  `;
}

function createJobCard(job) {
  const url = safeHttpUrl(job.url);
  const isSaved = state.savedJobIds.has(job.url);
  const isCompared = state.compare.some((item) => item.url === job.url);
  const description = String(job.description || '').slice(0, 220);
  const meta = [];

  if (job.location) {
    meta.push(`
      <span class="job-meta-item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        ${escapeHtml(job.location)}
      </span>
    `);
  }

  if (job.salary && !/thương lượng|thỏa thuận/i.test(String(job.salary))) {
    meta.push(`
      <span class="job-meta-item salary">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="12" x2="12" y1="2" y2="22"></line>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
        ${escapeHtml(job.salary)}
      </span>
    `);
  }

  if (job.experience) {
    meta.push(`
      <span class="job-meta-item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        ${escapeHtml(job.experience)}
      </span>
    `);
  }

  const color = platformColor(job.platform);

  return `
    <article class="job-card" data-url="${escapeHtml(job.url)}" tabindex="0" aria-label="${escapeHtml(job.title)} tại ${escapeHtml(job.company)}">
      <label class="job-compare-label" title="Chọn để so sánh">
        <input type="checkbox" class="job-card-checkbox" data-url="${escapeHtml(job.url)}" ${isCompared ? 'checked' : ''} aria-label="Chọn ${escapeHtml(job.title)} để so sánh">
      </label>
      <div class="job-card-header">
        <div class="job-card-info">
          <h3 class="job-title">${escapeHtml(job.title)}</h3>
          <p class="job-company">${escapeHtml(job.company)}</p>
        </div>
        <span class="job-platform-badge" style="background: ${color}1a; color: ${color}">
          ${escapeHtml(platformName(job.platform))}
        </span>
      </div>
      ${meta.length ? `<div class="job-meta">${meta.join('')}</div>` : ''}
      ${description ? `<p class="job-description">${escapeHtml(description)}</p>` : ''}
      <div class="job-actions">
        <button type="button" class="btn-detail" data-action="detail">Xem chi tiết</button>
        <button type="button" class="btn-save-job${isSaved ? ' saved' : ''}" data-action="save" aria-pressed="${isSaved}">
          ${saveButtonContent(isSaved)}
        </button>
        ${url ? `
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn-apply" data-action="apply">
            Ứng tuyển
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        ` : ''}
      </div>
    </article>
  `;
}

function saveButtonContent(isSaved) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
    </svg>
    ${isSaved ? 'Đã lưu' : 'Lưu'}
  `;
}

function renderEmptyState() {
  if (!els.emptyState) return;
  const query = escapeHtml(state.lastQuery);
  els.emptyState.innerHTML = `
    <div class="empty-icon" aria-hidden="true">😔</div>
    <p>Không tìm thấy kết quả cho "${query}"</p>
    <p class="empty-hint">Thử từ khóa khác, bỏ bộ lọc hoặc kiểm tra chính tả.</p>
    <div class="empty-suggestions">
      <button type="button" class="tag" data-query="React Developer">React</button>
      <button type="button" class="tag" data-query="Python Developer">Python</button>
      <button type="button" class="tag" data-query="Marketing">Marketing</button>
    </div>
  `;
  els.emptyState.classList.remove('hidden');
}

function hideAll() {
  els.resultsHeader?.classList.add('hidden');
  els.loading?.classList.add('hidden');
  els.errorMessage?.classList.add('hidden');
  els.emptyState?.classList.add('hidden');
  if (els.resultsContainer) els.resultsContainer.innerHTML = '';
}

function showError(message) {
  hideAll();
  if (els.errorText) els.errorText.textContent = message;
  els.errorMessage?.classList.remove('hidden');
  announce(message);
}

// ==================== JOB DETAIL ====================

async function openJobDetail(job) {
  if (!job) return;

  const url = safeHttpUrl(job.url);
  const {
    modal,
    close
  } = buildModal({
    title: job.title,
    subtitle: job.company,
    className: 'job-detail-modal'
  });

  const body = modal.querySelector('.modal-body');
  const render = (data, isLoading) => {
    body.innerHTML = renderDetailBody(data, isLoading, url);
  };

  render(job, true);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const params = new URLSearchParams({ url: job.url, platform: job.platform || '' });
    const response = await fetch(`${API_BASE}/api/job-detail?${params.toString()}`, {
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    const detail = data.detail || {};

    if (!response.ok || detail.blocked || (!detail.description && !detail.requirements)) {
      render(job, false);
      return;
    }

    render({
      ...job,
      location: detail.location || job.location,
      salary: detail.salary || job.salary,
      experience: detail.experience || job.experience,
      description: detail.description || job.description,
      requirements: detail.requirements || job.requirements
    }, false);
  } catch {
    render(job, false);
  } finally {
    clearTimeout(timeout);
  }

  body.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;

    if (action.dataset.action === 'copy-link') {
      copyToClipboard(url);
    }
    if (action.dataset.action === 'close-modal') {
      close();
    }
  });
}

function renderDetailBody(data, isLoading, url) {
  const safeUrl = safeHttpUrl(url || data.url);

  return `
    <div class="detail-info">
      <div class="detail-row">
        <span class="detail-label">Nền tảng:</span>
        <span class="detail-value platform-badge" style="background: ${platformColor(data.platform)}1a; color: ${platformColor(data.platform)}">${escapeHtml(platformName(data.platform))}</span>
      </div>
      ${data.location ? `
        <div class="detail-row">
          <span class="detail-label">Địa điểm:</span>
          <span class="detail-value">${escapeHtml(data.location)}</span>
        </div>
      ` : ''}
      ${data.salary ? `
        <div class="detail-row">
          <span class="detail-label">Mức lương:</span>
          <span class="detail-value salary">${escapeHtml(data.salary)}</span>
        </div>
      ` : ''}
      ${data.experience ? `
        <div class="detail-row">
          <span class="detail-label">Kinh nghiệm:</span>
          <span class="detail-value">${escapeHtml(data.experience)}</span>
        </div>
      ` : ''}
    </div>
    ${data.description ? `
      <div class="detail-section">
        <h3>Mô tả công việc</h3>
        <div class="detail-content">${escapeHtml(data.description).replace(/\n/g, '<br>')}</div>
      </div>
    ` : ''}
    ${data.requirements ? `
      <div class="detail-section">
        <h3>Yêu cầu ứng viên</h3>
        <div class="detail-content">${escapeHtml(data.requirements).replace(/\n/g, '<br>')}</div>
      </div>
    ` : ''}
    ${isLoading ? `
      <div class="detail-loading-inline">
        <div class="loading-spinner-small" aria-hidden="true"></div>
        <span>Đang tải thêm chi tiết...</span>
      </div>
    ` : ''}
    <div class="detail-actions">
      <button type="button" class="btn-copy-link" data-action="copy-link">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        Copy link
      </button>
      ${safeUrl ? `
        <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="btn-apply-full">
          Xem trên ${escapeHtml(platformName(data.platform))}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      ` : ''}
    </div>
  `;
}

function buildModal({ title, subtitle = '', className = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.dataset.dynamic = 'true';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', title);
  backdrop.innerHTML = `
    <div class="modal-content ${escapeHtml(className)}" role="document">
      <div class="modal-header">
        <div class="modal-header-info">
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="modal-header-company">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="modal-close" data-action="close-modal" aria-label="Đóng">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = activateModal(backdrop);
  backdrop.querySelector('[data-action="close-modal"]')?.addEventListener('click', close);
  return { modal: backdrop, close };
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Đã copy link vào clipboard');
  } catch {
    showToast('Không thể copy link', 'error');
  }
}

// ==================== SAVED JOBS (localStorage) ====================
// No accounts: saved jobs live in the visitor's own browser.

const SAVED_JOBS_KEY = 'findjob_saved_jobs';

function loadSavedJobs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_JOBS_KEY) || '[]');
    state.savedJobs = Array.isArray(parsed) ? parsed.filter((job) => job && job.url) : [];
  } catch {
    state.savedJobs = [];
  }
  state.savedJobIds = new Set(state.savedJobs.map((job) => job.url));
  refreshSaveButtons();
}

function persistSavedJobs() {
  try {
    localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify(state.savedJobs));
  } catch {
    /* storage unavailable */
  }
}

function refreshSaveButtons() {
  document.querySelectorAll('.btn-save-job').forEach((btn) => {
    const card = btn.closest('.job-card');
    if (!card) return;
    const saved = state.savedJobIds.has(card.dataset.url);
    setSaveButtonState(btn, saved);
  });
  updateSavedCount();
}

function updateSavedCount() {
  const badge = document.getElementById('saved-count');
  if (!badge) return;
  badge.textContent = String(state.savedJobs.length);
  badge.hidden = state.savedJobs.length === 0;
}

function setSaveButtonState(btn, saved) {
  btn.classList.toggle('saved', saved);
  btn.setAttribute('aria-pressed', String(saved));
  btn.innerHTML = saveButtonContent(saved);
}

function toggleSaveJob(job, btn) {
  if (state.savedJobIds.has(job.url)) {
    state.savedJobs = state.savedJobs.filter((item) => item.url !== job.url);
    state.savedJobIds.delete(job.url);
    persistSavedJobs();
    refreshSaveButtons();
    if (btn) setSaveButtonState(btn, false);
    showToast('Đã bỏ lưu việc làm');
    return;
  }

  state.savedJobs.unshift(pickJobFields(job));
  state.savedJobIds.add(job.url);
  persistSavedJobs();
  refreshSaveButtons();
  if (btn) setSaveButtonState(btn, true);
  showToast('Đã lưu việc làm');
}

function pickJobFields(job) {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    experience: job.experience,
    description: job.description,
    requirements: job.requirements,
    skills: job.skills,
    url: job.url,
    platform: job.platform
  };
}

function showSavedJobs() {
  openStaticModal(els.savedModal);
  renderSavedJobs();
  refreshSaveButtons();
}

function renderSavedJobs() {
  if (!els.savedList) return;

  if (state.savedJobs.length === 0) {
    els.savedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">📌</div>
        <p>Chưa có việc làm nào được lưu</p>
        <p class="empty-hint">Nhấn "Lưu" trên một việc làm để xem lại sau.</p>
      </div>
    `;
    return;
  }

  els.savedList.innerHTML = state.savedJobs.map((job) => `
    <div class="saved-job-item" data-url="${escapeHtml(job.url)}">
      <div class="saved-job-info">
        <h4>${escapeHtml(job.title)}</h4>
        <p>${escapeHtml(job.company || '')}${job.location ? ` • ${escapeHtml(job.location)}` : ''}</p>
        ${job.salary ? `<p class="job-salary">${escapeHtml(job.salary)}</p>` : ''}
      </div>
      <div class="saved-job-actions">
        <button type="button" class="btn-view-saved" data-action="view-saved">Xem</button>
        <button type="button" class="btn-remove-saved" data-action="remove-saved">Xóa</button>
      </div>
    </div>
  `).join('');
}

function removeSavedJob(jobUrl) {
  if (!jobUrl) return;
  state.savedJobs = state.savedJobs.filter((job) => job.url !== jobUrl);
  state.savedJobIds.delete(jobUrl);
  persistSavedJobs();
  renderSavedJobs();
  refreshSaveButtons();
  showToast('Đã xóa khỏi danh sách lưu');
}

// ==================== COMPARE ====================

function toggleCompare(job, checked) {
  if (checked) {
    if (state.compare.some((item) => item.url === job.url)) return;
    if (state.compare.length >= MAX_COMPARE) {
      showToast(`Chỉ so sánh tối đa ${MAX_COMPARE} việc làm`);
      return false;
    }
    state.compare.push(job);
  } else {
    state.compare = state.compare.filter((item) => item.url !== job.url);
  }
  updateCompareButton();
  return true;
}

function resetCompare() {
  state.compare = [];
  updateCompareButton();
}

function updateCompareButton() {
  const btn = document.getElementById('btn-compare');
  const count = document.getElementById('compare-count');
  if (!btn) return;
  btn.classList.toggle('hidden', state.compare.length < 2);
  if (count) count.textContent = String(state.compare.length);
}

function showCompareModal() {
  if (state.compare.length < 2) {
    showToast('Chọn ít nhất 2 việc để so sánh');
    return;
  }

  const table = els.compareTable;
  if (!table) return;

  const thead = table.querySelector('thead tr');
  const tbody = table.querySelector('tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = '<th scope="col">Thuộc tính</th>' + state.compare.map((job) => `
    <th scope="col">
      <div class="compare-job-header">
        <span class="compare-job-title">${escapeHtml(job.title)}</span>
        <span class="compare-job-company">${escapeHtml(job.company || '')}</span>
      </div>
    </th>
  `).join('');

  const rows = [
    { label: 'Nền tảng', key: 'platform', format: platformName },
    { label: 'Địa điểm', key: 'location' },
    { label: 'Mức lương', key: 'salary' },
    { label: 'Kinh nghiệm', key: 'experience' },
    { label: 'Mô tả', key: 'description' }
  ];

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <th scope="row">${row.label}</th>
      ${state.compare.map((job) => `<td>${escapeHtml(row.format ? row.format(job[row.key]) : (job[row.key] || '—'))}</td>`).join('')}
    </tr>
  `).join('');

  openStaticModal(els.compareModal);
}

// ==================== EXPORT ====================

function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportToCSV() {
  const jobs = state.filtered.length > 0 ? state.filtered : state.jobs;
  if (jobs.length === 0) {
    showToast('Không có dữ liệu để export');
    return;
  }

  const headers = ['Tên công việc', 'Công ty', 'Địa điểm', 'Mức lương', 'Kinh nghiệm', 'Mô tả', 'Nền tảng', 'Link'];
  const rows = jobs.map((job) => [
    job.title, job.company, job.location, job.salary, job.experience,
    job.description, platformName(job.platform), job.url
  ].map(csvCell).join(','));

  const csv = [headers.map(csvCell).join(','), ...rows].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `findjob-${(state.lastQuery || 'all').replace(/[^\w\-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);

  showToast(`Đã export ${jobs.length} việc làm`);
}

// ==================== MODALS ====================

function activateModal(modal) {
  const previouslyFocused = document.activeElement;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');

  const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusFirst = () => modal.querySelector(selector)?.focus();
  requestAnimationFrame(focusFirst);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    if (modal.dataset.dynamic === 'true') modal.remove();
    else modal.classList.add('hidden');
    modal._close = null;
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
      document.body.classList.remove('modal-open');
    }
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(modal.querySelectorAll(selector)).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown, true);
  modal._close = close;
  return close;
}

function openStaticModal(modal) {
  if (!modal || modal._close) return;
  modal._close = activateModal(modal);
}

function closeStaticModal(modal) {
  if (modal?._close) modal._close();
}

// ==================== EVENT WIRING ====================

function bindGlobalEvents() {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('change', handleGlobalChange);

  els.mobileBtn?.addEventListener('click', toggleMobileMenu);

  els.searchBtn?.addEventListener('click', () => performSearch());
  els.searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      performSearch();
    }
  });

  document.querySelectorAll('.filter-checkbox input').forEach((checkbox) => {
    checkbox.addEventListener('change', applyFilters);
  });
  els.sortSelect?.addEventListener('change', applyFilters);
  ['salary-filter', 'experience-filter', 'location-filter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', applyFilters);
  });

  els.resultsContainer?.addEventListener('click', handleResultsClick);
  els.resultsContainer?.addEventListener('keydown', handleResultsKeydown);

  els.savedList?.addEventListener('click', handleSavedListClick);
}

function handleGlobalClick(event) {
  if (event.target.classList?.contains('modal-backdrop') && event.target._close) {
    event.target._close();
    return;
  }

  const queryEl = event.target.closest('[data-query]');
  if (queryEl) {
    event.preventDefault();
    const query = queryEl.dataset.query;
    if (els.searchInput) els.searchInput.value = query;
    closeStaticModal(els.savedModal);
    const dynamicModal = document.querySelector('.modal-backdrop[data-dynamic="true"]');
    if (dynamicModal?._close) dynamicModal._close();
    performSearch(query);
    return;
  }

  const actionEl = event.target.closest('[data-action]');

  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (['show-saved-jobs',
    'show-compare', 'export-csv', 'toggle-advanced-filters', 'retry-search', 'close-mobile-menu',
    'clear-recent'].includes(action)) {
    event.preventDefault();
  }

  switch (action) {
    case 'show-saved-jobs':
      showSavedJobs();
      break;
    case 'close-mobile-menu':
      closeMobileMenu();
      break;
    case 'toggle-advanced-filters': {
      const panel = document.getElementById('advanced-filters');
      if (!panel) return;
      const willOpen = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !willOpen);
      actionEl.setAttribute('aria-expanded', String(willOpen));
      break;
    }
    case 'export-csv':
      exportToCSV();
      break;
    case 'show-compare':
      showCompareModal();
      break;
    case 'retry-search':
      performSearch(state.lastQuery);
      break;
    case 'clear-recent':
      state.recentSearches = [];
      persistRecentSearches();
      renderRecentSearches();
      break;
    case 'close-modal': {
      const modal = actionEl.closest('.modal-backdrop');
      if (modal) closeStaticModal(modal);
      break;
    }
    default:
      break;
  }
}

function handleGlobalKeydown(event) {
  const target = event.target;
  const isTyping = target instanceof HTMLElement
    && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault();
    els.searchInput?.focus();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (event.key === 'e' || event.key === 'E') && !isTyping) {
    event.preventDefault();
    exportToCSV();
    return;
  }

  if (event.key === '/' && !isTyping
    && !document.querySelector('.modal-backdrop:not(.hidden)')) {
    event.preventDefault();
    els.searchInput?.focus();
  }

  if (event.key === 'Escape') {
    closeMobileMenu();
  }
}

function handleGlobalChange(event) {
  if (event.target.classList.contains('job-card-checkbox')) {
    handleResultsChange(event);
  }
}

function handleResultsClick(event) {
  if (event.target.closest('a[data-action="apply"]')) return;
  if (event.target.closest('.job-compare-label, .job-card-checkbox')) return;

  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) {
    const card = event.target.closest('.job-card');
    if (card) openJobDetail(findJobByUrl(card.dataset.url));
    return;
  }

  const action = actionEl.dataset.action;
  const card = actionEl.closest('.job-card');
  const job = card ? findJobByUrl(card.dataset.url) : null;

  switch (action) {
    case 'detail':
      openJobDetail(job);
      break;
    case 'save':
      if (job) toggleSaveJob(job, actionEl);
      break;
    case 'toggle-platform': {
      const section = actionEl.closest('.platform-section');
      if (!section) return;
      const wasCollapsed = section.dataset.collapsed === 'true';
      const platform = actionEl.dataset.platform || section.dataset.platform;
      if (wasCollapsed) {
        state.collapsedPlatforms.delete(platform);
      } else {
        state.collapsedPlatforms.add(platform);
        state.expandedPlatforms.delete(platform);
      }
      applyFilters();
      if (wasCollapsed) {
        const toggle = Array.from(document.querySelectorAll('.platform-toggle'))
          .find((btn) => btn.dataset.platform === platform);
        toggle?.focus();
      }
      break;
    }
    case 'show-more': {
      const platform = actionEl.dataset.platform;
      if (platform) {
        state.expandedPlatforms.add(platform);
        applyFilters();
      }
      break;
    }
    case 'collapse-platform': {
      const platform = actionEl.dataset.platform;
      if (platform) {
        state.expandedPlatforms.delete(platform);
        applyFilters();
      }
      break;
    }
    default:
      break;
  }
}

function handleResultsChange(event) {
  const checkbox = event.target;
  if (!checkbox.classList.contains('job-card-checkbox')) return;

  const job = findJobByUrl(checkbox.dataset.url);
  if (!job) return;

  const accepted = toggleCompare(job, checkbox.checked);
  if (accepted === false) checkbox.checked = false;
}

function handleResultsKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.job-card');
  if (!card || event.target !== card) return;
  event.preventDefault();
  openJobDetail(findJobByUrl(card.dataset.url));
}

function handleSavedListClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;

  const item = actionEl.closest('.saved-job-item');
  if (!item) return;

  if (actionEl.dataset.action === 'remove-saved') {
    removeSavedJob(item.dataset.url);
    return;
  }

  if (actionEl.dataset.action === 'view-saved') {
    const saved = state.savedJobs.find((job) => job.url === item.dataset.url);
    if (saved) {
      closeStaticModal(els.savedModal);
      openJobDetail(saved);
    }
  }
}

function findJobByUrl(url) {
  return state.jobs.find((job) => job.url === url)
    || state.savedJobs.find((job) => job.url === url)
    || null;
}
