(function () {
  'use strict';

  const API_BASE = window.location.origin;
  const state = {
    token: null,
    currentUser: null,
    users: [],
    metrics: null,
    editingUserId: null,
    loadingSection: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function readToken() {
    try {
      return localStorage.getItem('authToken');
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
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

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
  }

  function formatMs(value) {
    const ms = Number(value) || 0;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }

  function showToast(message, type = 'info') {
    const region = byId('admin-toast-region');
    if (!region) return;

    const toast = document.createElement('div');
    toast.className = 'admin-toast';
    if (type === 'error') toast.style.background = '#b91c1c';
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
      clearSession();
      window.location.replace('/');
      throw new Error('unauthorized');
    }

    return response;
  }

  async function checkAuth() {
    state.token = readToken();
    if (!state.token) {
      window.location.replace('/');
      return false;
    }

    try {
      const response = await api('/api/auth/me');
      if (!response.ok) throw new Error('unauthenticated');
      const data = await response.json();
      state.currentUser = data.user;

      if (!state.currentUser || state.currentUser.role !== 'admin') {
        window.location.replace('/');
        return false;
      }

      byId('admin-name').textContent = state.currentUser.name || state.currentUser.email;
      byId('profile-name').value = state.currentUser.name || '';
      return true;
    } catch {
      clearSession();
      window.location.replace('/');
      return false;
    }
  }

  function loadDashboard() {
    return api('/api/admin/dashboard')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('dashboard'))))
      .then((data) => {
        const metrics = data.metrics || {};
        state.metrics = metrics;

        byId('stat-users').textContent = String(data.totalUsers ?? 0);
        byId('stat-requests').textContent = String(metrics.requests ?? 0);
        byId('stat-errors').textContent = String(metrics.errors ?? 0);
        byId('stat-uptime').textContent = String(Math.floor((metrics.uptime || 0) / 3600));

        byId('dashboard-details').textContent =
          `Cache: ${metrics.cacheSize ?? 0} mục · Cache hits: ${metrics.cacheHits ?? 0}`;
      })
      .catch(() => {
        byId('dashboard-details').textContent = 'Không thể tải số liệu dashboard.';
      });
  }

  function loadUsers() {
    if (state.loadingSection === 'users') return;
    state.loadingSection = 'users';

    api('/api/admin/users')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('users'))))
      .then((data) => {
        state.users = Array.isArray(data.users) ? data.users : [];
        renderUsers();
      })
      .catch(() => {
        byId('users-table-body').innerHTML =
          '<tr><td colspan="6" class="admin-empty">Không thể tải danh sách users.</td></tr>';
      })
      .finally(() => {
        state.loadingSection = null;
      });
  }

  function renderUsers() {
    const tbody = byId('users-table-body');
    const count = byId('user-count');
    if (count) count.textContent = `${state.users.length} users`;

    if (state.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-empty">Chưa có user nào</td></tr>';
      return;
    }

    tbody.innerHTML = state.users.map((user) => {
      const isSelf = user.id === state.currentUser?.id;
      const role = user.role === 'admin' ? 'admin' : 'user';
      const actions = isSelf
        ? '<span class="self-tag">(bạn)</span>'
        : `<div class="table-actions">
            <button type="button" class="btn-action edit" data-action="edit-user" data-id="${Number(user.id)}">Sửa</button>
            <button type="button" class="btn-action delete" data-action="delete-user" data-id="${Number(user.id)}">Xóa</button>
          </div>`;

      return `
        <tr>
          <td data-label="ID">${Number(user.id)}</td>
          <td data-label="Email">${escapeHtml(user.email)}</td>
          <td data-label="Tên">${escapeHtml(user.name || '-')}</td>
          <td data-label="Role"><span class="role-badge ${role}">${role}</span></td>
          <td data-label="Ngày tạo">${escapeHtml(formatDate(user.created_at))}</td>
          <td data-label="Hành động">${actions}</td>
        </tr>
      `;
    }).join('');
  }

  function loadScrapers() {
    const render = (metrics) => {
      const times = metrics?.scrapeTimes || {};
      const entries = Object.entries(times);

      if (entries.length === 0) {
        byId('scrapers-table-body').innerHTML =
          '<tr><td colspan="4" class="admin-empty">Chưa có dữ liệu scrape.</td></tr>';
        return;
      }

      byId('scrapers-table-body').innerHTML = entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([platform, info]) => `
          <tr>
            <td data-label="Nền tảng">${escapeHtml(platform)}</td>
            <td data-label="Thời gian TB">${escapeHtml(formatMs(info.avgMs))}</td>
            <td data-label="Số lần scrape">${Number(info.totalScrapes) || 0}</td>
            <td data-label="Lỗi">${Number(info.errors) || 0}</td>
          </tr>
        `).join('');
    };

    if (state.metrics) {
      render(state.metrics);
      return;
    }

    api('/api/admin/dashboard')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('metrics'))))
      .then((data) => {
        state.metrics = data.metrics || {};
        render(state.metrics);
      })
      .catch(() => {
        byId('scrapers-table-body').innerHTML =
          '<tr><td colspan="4" class="admin-empty">Không thể tải số liệu scraper.</td></tr>';
      });
  }

  function showSection(name, button) {
    document.querySelectorAll('.admin-section').forEach((section) => {
      section.classList.toggle('active', section.id === `section-${name}`);
    });

    document.querySelectorAll('.sidebar-item[data-section]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (name === 'users') loadUsers();
    if (name === 'scrapers') loadScrapers();
    if (name === 'dashboard') loadDashboard();
  }

  function openEditModal(id) {
    const user = state.users.find((item) => item.id === id);
    if (!user) return;

    state.editingUserId = id;
    byId('edit-user-email').textContent = user.email || '-';
    byId('edit-user-role').value = user.role === 'admin' ? 'admin' : 'user';

    const modal = byId('edit-user-modal');
    modal.classList.remove('hidden');
    byId('edit-user-role').focus();
  }

  function closeEditModal() {
    byId('edit-user-modal').classList.add('hidden');
    state.editingUserId = null;
  }

  async function saveUserRole() {
    if (!state.editingUserId) return;

    const role = byId('edit-user-role').value;
    const button = document.querySelector('[data-action="save-role"]');
    if (button) button.disabled = true;

    try {
      const response = await api(`/api/admin/users/${state.editingUserId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        showToast(data.error || 'Không thể cập nhật role', 'error');
        return;
      }

      closeEditModal();
      showToast('Cập nhật role thành công');
      loadUsers();
    } catch {
      showToast('Không thể cập nhật role', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteUser(id) {
    const user = state.users.find((item) => item.id === id);
    if (!user) return;

    const label = user.email || user.name || `#${id}`;
    if (!window.confirm(`Bạn có chắc muốn xóa user "${label}"?`)) return;

    try {
      const response = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        showToast(data.error || 'Không thể xóa user', 'error');
        return;
      }

      showToast('Xóa user thành công');
      loadUsers();
    } catch {
      showToast('Không thể xóa user', 'error');
    }
  }

  async function saveProfile(event) {
    event.preventDefault();

    const input = byId('profile-name');
    const name = input.value.trim();

    if (!name) {
      showToast('Tên không được để trống', 'error');
      input.focus();
      return;
    }

    const button = byId('profile-submit');
    button.disabled = true;

    try {
      const response = await api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        showToast(data.error || 'Cập nhật thất bại', 'error');
        return;
      }

      state.currentUser = data.user;
      byId('admin-name').textContent = data.user.name || data.user.email;
      showToast('Cập nhật tên thành công');
    } catch {
      showToast('Cập nhật thất bại', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function logout() {
    clearSession();
    window.location.replace('/');
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const sectionButton = event.target.closest('[data-section]');
      if (sectionButton) {
        showSection(sectionButton.dataset.section, sectionButton);
        return;
      }

      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;

      switch (actionEl.dataset.action) {
        case 'close-edit-modal':
          closeEditModal();
          break;
        case 'edit-user':
          openEditModal(Number(actionEl.dataset.id));
          break;
        case 'delete-user':
          deleteUser(Number(actionEl.dataset.id));
          break;
        case 'save-role':
          saveUserRole();
          break;
        case 'logout':
          logout();
          break;
        default:
          break;
      }
    });

    byId('edit-user-modal')?.addEventListener('click', (event) => {
      if (event.target.id === 'edit-user-modal') closeEditModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeEditModal();
    });

    byId('profile-form')?.addEventListener('submit', saveProfile);
  }

  async function init() {
    bindEvents();
    const authorized = await checkAuth();
    if (!authorized) return;
    loadDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
