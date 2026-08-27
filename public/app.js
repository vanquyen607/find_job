const API_BASE = window.location.origin;

// ==================== AUTH STATE ====================
let currentUser = null;
let authToken = localStorage.getItem('authToken');

// DOM Elements (lazy-loaded after app page is shown)
let searchInput, searchBtn, btnText, btnSpinner, resultsContainer, resultsHeader;
let searchQuery, resultCount, loadTime, loading, errorMessage, errorText, emptyState;
let totalJobs, tags, filterBar, sortSelect, progressBar, progressFill, progressText;

function initDOMElements() {
  searchInput = document.getElementById('search-input');
  searchBtn = document.getElementById('search-btn');
  btnText = searchBtn?.querySelector('.btn-text');
  btnSpinner = searchBtn?.querySelector('.btn-spinner');
  resultsContainer = document.getElementById('results-container');
  resultsHeader = document.getElementById('results-header');
  searchQuery = document.getElementById('search-query');
  resultCount = document.getElementById('result-count');
  loadTime = document.getElementById('load-time');
  loading = document.getElementById('loading');
  errorMessage = document.getElementById('error-message');
  errorText = document.getElementById('error-text');
  emptyState = document.getElementById('empty-state');
  totalJobs = document.getElementById('total-jobs');
  tags = document.querySelectorAll('.tag');
  filterBar = document.getElementById('filter-bar');
  sortSelect = document.getElementById('sort-select');
  progressBar = document.getElementById('progress-bar');
  progressFill = document.getElementById('progress-fill');
  progressText = document.getElementById('progress-text');
}

let isLoading = false;
let allJobs = [];
let filteredJobs = [];

// Load recent searches from localStorage
const recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');

// ==================== PAGE NAVIGATION ====================
function showLanding() {
  document.getElementById('landing-page').classList.remove('hidden');
  document.getElementById('app-page').classList.add('hidden');
}

function showApp() {
  document.getElementById('landing-page').classList.add('hidden');
  document.getElementById('app-page').classList.remove('hidden');
  initDOMElements();
  initApp();
}

// ==================== AUTH FUNCTIONS ====================
async function checkAuth() {
  if (!authToken) {
    showLanding();
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      showApp();
      updateAuthUI(true);
    } else {
      localStorage.removeItem('authToken');
      authToken = null;
      showLanding();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showLanding();
  }
}

function updateAuthUI(isLoggedIn) {
  const userMenu = document.getElementById('user-menu');
  const adminLink = document.getElementById('admin-link');
  
  if (isLoggedIn && currentUser) {
    userMenu.classList.remove('hidden');
    document.getElementById('user-name').textContent = currentUser.name || currentUser.email;
    document.getElementById('user-avatar').textContent = (currentUser.name || currentUser.email).charAt(0).toUpperCase();
    
    // Show admin link if user is admin
    if (currentUser.role === 'admin') {
      adminLink.style.display = 'flex';
    } else {
      adminLink.style.display = 'none';
    }
  } else {
    userMenu.classList.add('hidden');
  }
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  updateAuthUI(false);
  toggleUserDropdown(false);
  showLanding();
  showToast('Đã đăng xuất');
}

function toggleUserDropdown(show = null) {
  const dropdown = document.getElementById('user-dropdown');
  if (show === null) {
    dropdown.classList.toggle('hidden');
  } else if (show) {
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const userMenu = document.getElementById('user-menu');
  if (userMenu && !userMenu.contains(e.target)) {
    toggleUserDropdown(false);
  }
});

// ==================== SAVED JOBS ====================
async function toggleSaveJob(job, btn) {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const isSaved = btn.classList.contains('saved');
  
  try {
    if (isSaved) {
      // Unsave
      const response = await fetch(`${API_BASE}/api/saved-jobs/${job.id || encodeURIComponent(job.url)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      
      if (response.ok) {
        btn.classList.remove('saved');
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          Lưu
        `;
        showToast('Đã xóa khỏi danh sách lưu');
      }
    } else {
      // Save - first need to get job ID from URL
      const saveResponse = await fetch(`${API_BASE}/api/saved-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ jobUrl: job.url, jobData: job })
      });
      
      if (saveResponse.ok) {
        btn.classList.add('saved');
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          Đã lưu
        `;
        showToast('Đã lưu việc làm');
      }
    }
  } catch (error) {
    console.error('Save job error:', error);
    showToast('Có lỗi xảy ra');
  }
}

async function showSavedJobs() {
  toggleUserDropdown(false);
  
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const modal = document.getElementById('saved-jobs-modal');
  const list = document.getElementById('saved-jobs-list');
  
  modal.classList.remove('hidden');
  list.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  
  try {
    const response = await fetch(`${API_BASE}/api/saved-jobs`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    const data = await response.json();
    
    if (data.jobs.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Chưa có việc làm nào được lưu</p></div>';
      return;
    }
    
    list.innerHTML = data.jobs.map(job => `
      <div class="saved-job-item">
        <div class="saved-job-info">
          <h4>${escapeHtml(job.title)}</h4>
          <p>${escapeHtml(job.company)} • ${escapeHtml(job.location)}</p>
          <p class="job-salary">${escapeHtml(job.salary)}</p>
        </div>
        <button class="btn-remove-saved" onclick="removeSavedJob(${job.id})">Xóa</button>
      </div>
    `).join('');
  } catch (error) {
    list.innerHTML = '<div class="empty-state"><p>Không thể tải danh sách</p></div>';
  }
}

function closeSavedJobsModal() {
  document.getElementById('saved-jobs-modal').classList.add('hidden');
}

async function removeSavedJob(jobId) {
  try {
    await fetch(`${API_BASE}/api/saved-jobs/${jobId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    showSavedJobs(); // Refresh list
    showToast('Đã xóa');
  } catch (error) {
    showToast('Có lỗi xảy ra');
  }
}

function showSearchHistory() {
  toggleUserDropdown(false);
  showToast('Tính năng đang phát triển');
}

async function performSearch() {
  const query = searchInput?.value?.trim();
  if (!query || isLoading) return;

  // Save to recent searches
  saveRecentSearch(query);

  setLoading(true);
  hideAll();
  loading?.classList.remove('hidden');
  showProgress();

  const startTime = Date.now();

  try {
    const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Có lỗi xảy ra');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    allJobs = data.jobs || [];
    applyFilters();
    
    hideProgress();
    totalJobs.textContent = allJobs.length;
  } catch (err) {
    showError(err.message);
    hideProgress();
  } finally {
    setLoading(false);
  }
}

function applyFilters() {
  const selectedPlatforms = Array.from(document.querySelectorAll('.filter-checkbox input:checked'))
    .map(cb => cb.value);
  
  const sortBy = sortSelect.value;
  const salaryFilter = document.getElementById('salary-filter')?.value || '';
  const experienceFilter = document.getElementById('experience-filter')?.value || '';
  const locationFilter = document.getElementById('location-filter')?.value || '';

  // Filter by platform
  filteredJobs = allJobs.filter(job => selectedPlatforms.includes(job.platform));

  // Filter by salary
  if (salaryFilter) {
    filteredJobs = filteredJobs.filter(job => {
      const salary = extractSalary(job.salary);
      if (salaryFilter === '30+') return salary >= 30;
      const [min, max] = salaryFilter.split('-').map(Number);
      return salary >= min && salary <= max;
    });
  }

  // Filter by experience
  if (experienceFilter) {
    filteredJobs = filteredJobs.filter(job => {
      const exp = job.experience?.toLowerCase() || '';
      if (experienceFilter === 'fresher') return exp.includes('0') || exp.includes('fresher') || exp.includes('mới');
      if (experienceFilter === '1-2') return exp.includes('1') || exp.includes('2');
      if (experienceFilter === '3-5') return exp.includes('3') || exp.includes('4') || exp.includes('5');
      if (experienceFilter === '5+') return exp.includes('5') || exp.includes('6') || exp.includes('7');
      return true;
    });
  }

  // Filter by location
  if (locationFilter) {
    filteredJobs = filteredJobs.filter(job => {
      const loc = job.location?.toLowerCase() || '';
      if (locationFilter === 'ha-noi') return loc.includes('hà nội') || loc.includes('ha noi');
      if (locationFilter === 'hcm') return loc.includes('hồ chí minh') || loc.includes('hcm');
      if (locationFilter === 'da-nang') return loc.includes('đà nẵng') || loc.includes('da nang');
      if (locationFilter === 'other') return !loc.includes('hà nội') && !loc.includes('hồ chí minh') && !loc.includes('đà nẵng');
      return true;
    });
  }

  // Sort
  filteredJobs = sortJobs(filteredJobs, sortBy);

  // Display
  displayResults(filteredJobs, searchInput.value);
}

function toggleAdvancedFilters() {
  const filters = document.getElementById('advanced-filters');
  filters.classList.toggle('hidden');
}

function sortJobs(jobs, sortBy) {
  const sorted = [...jobs];
  
  switch (sortBy) {
    case 'salary-desc':
      sorted.sort((a, b) => extractSalary(b.salary) - extractSalary(a.salary));
      break;
    case 'salary-asc':
      sorted.sort((a, b) => extractSalary(a.salary) - extractSalary(b.salary));
      break;
    case 'platform':
      sorted.sort((a, b) => a.platform.localeCompare(b.platform));
      break;
    case 'relevance':
    default:
      // Keep original order
      break;
  }
  
  return sorted;
}

function extractSalary(salary) {
  if (!salary || salary === 'Thương lượng') return 0;
  const match = salary.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function displayResults(jobs, query) {
  hideAll();

  if (jobs.length === 0) {
    if (emptyState) {
      emptyState.innerHTML = `
        <div class="empty-icon">😔</div>
        <p>Không tìm thấy kết quả cho "${escapeHtml(query)}"</p>
        <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">Thử từ khóa khác hoặc kiểm tra chính tả</p>
      `;
      emptyState.classList.remove('hidden');
    }
    return;
  }

  if (searchQuery) searchQuery.textContent = query;
  if (resultCount) resultCount.textContent = jobs.length;
  resultsHeader?.classList.remove('hidden');

  // Group by platform
  const grouped = {};
  jobs.forEach(job => {
    if (!grouped[job.platform]) grouped[job.platform] = [];
    grouped[job.platform].push(job);
  });

  // Platform order
  const platformOrder = ['vietnamworks', 'careerviet', 'itviec', 'glints', 'topcv'];
  const platformNames = {
    'vietnamworks': 'VietnamWorks',
    'careerviet': 'CareerViet',
    'itviec': 'ITviec',
    'glints': 'Glints',
    'topcv': 'TopCV'
  };

  // Render grouped results
  let html = '';
  for (const platform of platformOrder) {
    const platformJobs = grouped[platform];
    if (!platformJobs || platformJobs.length === 0) continue;

    html += `
      <div class="platform-section">
        <h3 class="platform-title" data-platform="${platform}">
          <span class="platform-badge" style="background: ${getPlatformColor(platform)}20; color: ${getPlatformColor(platform)}">
            ${platformNames[platform] || platform.toUpperCase()}
          </span>
          <span class="platform-count">${platformJobs.length} việc</span>
          <svg class="platform-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </h3>
        <div class="platform-jobs">
          ${platformJobs.map(job => createJobCard(job)).join('')}
        </div>
      </div>
    `;
  }

  if (resultsContainer) {
    resultsContainer.innerHTML = html;

    // Add click handlers for job cards
    resultsContainer.querySelectorAll('.job-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't trigger if clicking on buttons or links
        if (e.target.closest('.btn-detail') || e.target.closest('.btn-apply')) return;
        
        const job = allJobs.find(j => j.url === card.dataset.url);
        if (job) showJobDetail(job);
      });
    });
  }
}

function createJobCard(job) {
  return `
    <div class="job-card" data-url="${escapeHtml(job.url)}" data-job-id="${job.id || ''}">
      <input type="checkbox" class="job-card-checkbox" onchange="toggleCompareJob(${JSON.stringify(job).replace(/"/g, '&quot;')}, this)" title="Chọn để so sánh">
      <div class="job-card-header">
        <div class="job-card-info">
          <h3 class="job-title">${escapeHtml(job.title)}</h3>
          <p class="job-company">${escapeHtml(job.company)}</p>
        </div>
        <span class="job-platform-badge" style="background: ${getPlatformColor(job.platform)}20; color: ${getPlatformColor(job.platform)}">
          ${job.platform.toUpperCase()}
        </span>
      </div>
      <div class="job-meta">
        ${job.location ? `
          <span class="job-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            ${escapeHtml(job.location)}
          </span>
        ` : ''}
        ${job.salary && job.salary !== 'Thương lượng' ? `
          <span class="job-meta-item salary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" x2="12" y1="2" y2="22"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
            ${escapeHtml(job.salary)}
          </span>
        ` : ''}
        ${job.experience ? `
          <span class="job-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${escapeHtml(job.experience)}
          </span>
        ` : ''}
      </div>
      ${job.description ? `<p class="job-description">${escapeHtml(job.description)}</p>` : ''}
      <div class="job-actions">
        <button class="btn-detail">
          Xem chi tiết
        </button>
        <button class="btn-save-job" onclick="event.stopPropagation(); toggleSaveJob(${JSON.stringify(job).replace(/"/g, '&quot;')}, this)">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          Lưu
        </button>
        ${job.url ? `
          <a href="${escapeHtml(job.url)}" target="_blank" class="btn-apply" onclick="event.stopPropagation()">
            Ứng tuyển
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        ` : ''}
      </div>
    </div>
  `;
}

async function showJobDetail(job) {
  // Helper: render modal body consistently for all platforms
  const renderModalBody = (data, isLoading = false) => {
    const { location, salary, experience, description, requirements, platform } = data;
    
    return `
      <div class="detail-info">
        <div class="detail-row">
          <span class="detail-label">Nền tảng:</span>
          <span class="detail-value platform-badge" style="background: ${getPlatformColor(platform)}20; color: ${getPlatformColor(platform)}">${platform.toUpperCase()}</span>
        </div>
        ${location ? `
        <div class="detail-row">
          <span class="detail-label">Địa điểm:</span>
          <span class="detail-value">${escapeHtml(location)}</span>
        </div>
        ` : ''}
        ${salary ? `
        <div class="detail-row">
          <span class="detail-label">Mức lương:</span>
          <span class="detail-value salary">${escapeHtml(salary)}</span>
        </div>
        ` : ''}
        ${experience ? `
        <div class="detail-row">
          <span class="detail-label">Kinh nghiệm:</span>
          <span class="detail-value">${escapeHtml(experience)}</span>
        </div>
        ` : ''}
      </div>
      ${description ? `
        <div class="detail-section">
          <h3>Mô tả công việc</h3>
          <div class="detail-content">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
        </div>
      ` : ''}
      ${requirements ? `
        <div class="detail-section">
          <h3>Yêu cầu</h3>
          <div class="detail-content">${escapeHtml(requirements).replace(/\n/g, '<br>')}</div>
        </div>
      ` : ''}
      ${isLoading ? `
        <div class="detail-loading-inline">
          <div class="loading-spinner-small"></div>
          <span>Đang tải thêm chi tiết...</span>
        </div>
      ` : ''}
      <div class="detail-actions">
        <button class="btn-copy-link" onclick="copyJobLink('${escapeHtml(job.url)}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          Copy link
        </button>
        ${job.url ? `
          <a href="${escapeHtml(job.url)}" target="_blank" class="btn-apply-full">
            Xem trên ${platform}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        ` : ''}
      </div>
    `;
  };

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-header-info">
          <h2>${escapeHtml(job.title)}</h2>
          <p class="modal-header-company">${escapeHtml(job.company)}</p>
        </div>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        ${renderModalBody(job, true)}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  const close = () => modal.remove();
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  // Escape key handler
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Fetch detail with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout
    
    const response = await fetch(`${API_BASE}/api/job-detail?url=${encodeURIComponent(job.url)}&platform=${encodeURIComponent(job.platform)}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const data = await response.json();
    const detail = data.detail || job;

    // Check if blocked or no data
    if (detail.blocked || (!detail.description && !detail.requirements)) {
      // Use search data only
      modal.querySelector('.modal-body').innerHTML = renderModalBody(job, false);
      return;
    }

    // Merge detail data with job data
    const mergedData = {
      ...job,
      location: detail.location || job.location,
      salary: detail.salary || job.salary,
      experience: detail.experience || job.experience,
      description: detail.description || job.description,
      requirements: detail.requirements || job.requirements,
      platform: job.platform
    };
    
    modal.querySelector('.modal-body').innerHTML = renderModalBody(mergedData, false);
  } catch (err) {
    // On error, show search data only
    modal.querySelector('.modal-body').innerHTML = renderModalBody(job, false);
  }
}

function copyJobLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.btn-copy-link');
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Đã copy!
    `;
    showToast('Đã copy link vào clipboard');
    
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        Copy link
      `;
    }, 2000);
  });
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

function saveRecentSearch(query) {
  if (!recentSearches.includes(query)) {
    recentSearches.unshift(query);
    if (recentSearches.length > 5) recentSearches.pop();
    localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
  }
}

function showProgress() {
  progressBar?.classList.remove('hidden');
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Đang tìm kiếm...';
  
  // Animate progress
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 30;
    if (progress > 90) progress = 90;
    if (progressFill) progressFill.style.width = progress + '%';
    
    if (progressText) {
      if (progress < 30) {
        progressText.textContent = 'Đang tìm trên VietnamWorks...';
      } else if (progress < 60) {
        progressText.textContent = 'Đang tìm trên CareerViet...';
      } else if (progress < 80) {
        progressText.textContent = 'Đang tìm trên ITviec...';
      } else {
        progressText.textContent = 'Đang tìm trên Glints...';
      }
    }
  }, 500);
  
  if (progressBar) progressBar._interval = interval;
}

function hideProgress() {
  if (progressBar?._interval) {
    clearInterval(progressBar._interval);
  }
  if (progressFill) progressFill.style.width = '100%';
  if (progressText) progressText.textContent = 'Hoàn thành!';
  
  setTimeout(() => {
    progressBar?.classList.add('hidden');
  }, 500);
}

function getPlatformColor(platform) {
  const colors = {
    'careerviet': '#22c55e',
    'topcv': '#ef4444',
    'vietnamworks': '#3b82f6',
    'itviec': '#f59e0b',
    'glints': '#06b6d4'
  };
  return colors[platform] || '#6366f1';
}

function setLoading(loadingState) {
  isLoading = loadingState;
  if (searchBtn) searchBtn.disabled = loadingState;
  btnText?.classList.toggle('hidden', loadingState);
  btnSpinner?.classList.toggle('hidden', !loadingState);
}

function hideAll() {
  resultsHeader?.classList.add('hidden');
  if (resultsContainer) resultsContainer.innerHTML = '';
  loading?.classList.add('hidden');
  errorMessage?.classList.add('hidden');
  emptyState?.classList.add('hidden');
}

function showError(message) {
  hideAll();
  if (errorText) errorText.textContent = message;
  errorMessage?.classList.remove('hidden');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== COMPARE JOBS ====================
let compareJobs = [];

function toggleCompareJob(job, checkbox) {
  if (checkbox.checked) {
    if (compareJobs.length < 4) {
      compareJobs.push(job);
    } else {
      checkbox.checked = false;
      showToast('Chỉ so sánh tối đa 4 việc');
      return;
    }
  } else {
    compareJobs = compareJobs.filter(j => j.url !== job.url);
  }
  
  updateCompareButton();
}

function updateCompareButton() {
  const btn = document.getElementById('btn-compare');
  const count = document.getElementById('compare-count');
  
  if (compareJobs.length >= 2) {
    btn.classList.remove('hidden');
    count.textContent = compareJobs.length;
  } else {
    btn.classList.add('hidden');
  }
}

function showCompareModal() {
  if (compareJobs.length < 2) {
    showToast('Chọn ít nhất 2 việc để so sánh');
    return;
  }
  
  const modal = document.getElementById('compare-modal');
  const table = document.getElementById('compare-table');
  
  // Build header
  const thead = table.querySelector('thead tr');
  thead.innerHTML = '<th>Thuộc tính</th>';
  compareJobs.forEach(job => {
    thead.innerHTML += `
      <th>
        <div class="compare-job-header">
          <span class="compare-job-title">${escapeHtml(job.title.substring(0, 30))}...</span>
          <span class="compare-job-company">${escapeHtml(job.company)}</span>
        </div>
      </th>
    `;
  });
  
  // Build body
  const tbody = table.querySelector('tbody');
  const rows = [
    { label: 'Nền tảng', key: 'platform' },
    { label: 'Công ty', key: 'company' },
    { label: 'Địa điểm', key: 'location' },
    { label: 'Mức lương', key: 'salary' },
    { label: 'Kinh nghiệm', key: 'experience' },
    { label: 'Kỹ năng', key: 'description' }
  ];
  
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td><strong>${row.label}</strong></td>
      ${compareJobs.map(job => `<td>${escapeHtml(job[row.key] || '-')}</td>`).join('')}
    </tr>
  `).join('');
  
  modal.classList.remove('hidden');
}

function closeCompareModal() {
  document.getElementById('compare-modal').classList.add('hidden');
}

// ==================== EXPORT CSV ====================
function exportToCSV() {
  const jobs = filteredJobs.length > 0 ? filteredJobs : allJobs;
  
  if (jobs.length === 0) {
    showToast('Không có dữ liệu để export');
    return;
  }
  
  const headers = ['Tên công việc', 'Công ty', 'Địa điểm', 'Mức lương', 'Kinh nghiệm', 'Kỹ năng', 'Nền tảng', 'Link'];
  const rows = jobs.map(job => [
    `"${(job.title || '').replace(/"/g, '""')}"`,
    `"${(job.company || '').replace(/"/g, '""')}"`,
    `"${(job.location || '').replace(/"/g, '""')}"`,
    `"${(job.salary || '').replace(/"/g, '""')}"`,
    `"${(job.experience || '').replace(/"/g, '""')}"`,
    `"${(job.description || '').replace(/"/g, '""')}"`,
    `"${job.platform}"`,
    `"${job.url || ''}"`
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `findjob-${searchInput.value || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  
  showToast(`Đã export ${jobs.length} việc làm`);
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  // Ctrl+E to export
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault();
    exportToCSV();
  }
  
  // Ctrl+K to focus search
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

function initApp() {
  if (!searchInput) return;
  
  // Search functionality
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  
  searchBtn.addEventListener('click', performSearch);
  
  // Tags
  tags.forEach(tag => {
    tag.addEventListener('click', () => {
      searchInput.value = tag.dataset.query;
      performSearch();
    });
  });
  
  // Filter checkboxes
  document.querySelectorAll('.filter-checkbox input').forEach(checkbox => {
    checkbox.addEventListener('change', applyFilters);
  });
  
  // Sort
  sortSelect?.addEventListener('change', applyFilters);
  
  // Platform section toggle
  resultsContainer?.addEventListener('click', (e) => {
    const platformTitle = e.target.closest('.platform-title');
    if (platformTitle) {
      const section = platformTitle.closest('.platform-section');
      const jobsContainer = section.querySelector('.platform-jobs');
      const chevron = platformTitle.querySelector('.platform-chevron');
      
      platformTitle.classList.toggle('collapsed');
      jobsContainer.classList.toggle('hidden');
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      if (document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput?.focus();
      }
    }
    
    if (e.key === 'Escape') {
      const modal = document.querySelector('.modal-backdrop:not(.hidden)');
      if (modal) modal.classList.add('hidden');
    }
  });
}
