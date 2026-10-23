(function () {
  'use strict';

  const API_BASE = window.location.origin;
  const REQUEST_TIMEOUT = 20000;

  function byId(id) {
    return document.getElementById(id);
  }

  function showError(message) {
    const el = byId('error-message');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function hideError() {
    const el = byId('error-message');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  function setLoading(loading, successLabel) {
    const button = byId('submit-btn');
    const spinner = byId('submit-spinner');
    const label = byId('submit-label');
    if (!button || !label) return;

    button.disabled = loading;
    button.setAttribute('aria-busy', String(loading));
    if (spinner) spinner.hidden = !loading;

    if (successLabel) {
      button.classList.add('success');
      label.textContent = successLabel;
      if (spinner) spinner.hidden = true;
      return;
    }

    if (!button.classList.contains('success')) {
      label.textContent = button.dataset.idleLabel || label.textContent;
    }
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-toggle-password]').forEach((toggle) => {
      const input = byId(toggle.dataset.togglePassword);
      if (!input) return;

      toggle.addEventListener('click', () => {
        const willShow = input.type === 'password';
        input.type = willShow ? 'text' : 'password';
        toggle.textContent = willShow ? 'Ẩn' : 'Hiện';
        toggle.setAttribute('aria-pressed', String(willShow));
        input.focus({ preventScroll: true });
      });
    });
  }

  async function postJson(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Máy chủ phản hồi quá lâu, vui lòng thử lại');
      }
      if (error instanceof TypeError) {
        throw new Error('Không thể kết nối tới máy chủ, vui lòng thử lại');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function storeSession(data) {
    try {
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('currentUser', JSON.stringify(data.user));
    } catch {
      /* storage unavailable */
    }
  }

  function redirectToApp(delay) {
    window.setTimeout(() => window.location.replace('/'), delay);
  }

  function initLogin() {
    const form = byId('login-form');
    if (!form) return;

    byId('submit-btn').dataset.idleLabel = 'Đăng nhập';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideError();

      const email = byId('email').value.trim();
      const password = byId('password').value;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Vui lòng nhập email hợp lệ');
        byId('email').focus();
        return;
      }

      if (password.length < 8) {
        showError('Mật khẩu phải có ít nhất 8 ký tự');
        byId('password').focus();
        return;
      }

      setLoading(true);

      try {
        const data = await postJson('/api/auth/login', { email, password });
        storeSession(data);
        setLoading(true, 'Đăng nhập thành công!');
        redirectToApp(700);
      } catch (error) {
        showError(error.message);
        setLoading(false);
        byId('password').focus();
      }
    });
  }

  function initRegister() {
    const form = byId('register-form');
    if (!form) return;

    byId('submit-btn').dataset.idleLabel = 'Đăng ký';

    try {
      const savedEmail = sessionStorage.getItem('signupEmail');
      if (savedEmail) {
        byId('email').value = savedEmail;
        sessionStorage.removeItem('signupEmail');
      }
    } catch {
      /* storage unavailable */
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideError();

      const name = byId('name').value.trim();
      const email = byId('email').value.trim();
      const password = byId('password').value;
      const confirm = byId('confirm-password').value;

      if (name.length > 80) {
        showError('Họ tên không được vượt quá 80 ký tự');
        byId('name').focus();
        return;
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Vui lòng nhập email hợp lệ');
        byId('email').focus();
        return;
      }

      if (password.length < 8 || password.length > 128) {
        showError('Mật khẩu phải có từ 8 đến 128 ký tự');
        byId('password').focus();
        return;
      }

      if (password !== confirm) {
        showError('Mật khẩu xác nhận không khớp');
        byId('confirm-password').focus();
        return;
      }

      setLoading(true);

      try {
        const data = await postJson('/api/auth/register', { name, email, password });
        storeSession(data);
        setLoading(true, 'Tạo tài khoản thành công!');
        redirectToApp(700);
      } catch (error) {
        showError(error.message);
        setLoading(false);
        byId('password').focus();
      }
    });
  }

  function init() {
    bindPasswordToggles();

    let hasToken = false;
    try {
      hasToken = Boolean(localStorage.getItem('authToken'));
    } catch {
      hasToken = false;
    }

    if (hasToken) {
      window.location.replace('/');
      return;
    }

    initLogin();
    initRegister();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
