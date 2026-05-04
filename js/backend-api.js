const API_BASE = window.location.origin;

class BackendAPI {
  constructor() {
    this.token = localStorage.getItem('auth_token') || '';
    this.refreshToken = localStorage.getItem('refresh_token') || '';
    this.csrfToken = '';
    this.csrfSession = '';
    this.user = null;
    this._isRefreshing = false;
    this._refreshSubscribers = [];
    this._online = navigator.onLine;
    this._pendingRequests = new Map();
    this._maxRetries = 3;
    this._retryDelay = 1000;

    window.addEventListener('online', () => {
      this._online = true;
      Utils.showToast('网络已恢复', 'success');
      this._processPendingRequests();
    });

    window.addEventListener('offline', () => {
      this._online = false;
      Utils.showToast('网络连接已断开', 'warning');
    });
  }

  async _fetchCsrfToken() {
    try {
      const response = await fetch(`${API_BASE}/api/csrf-token`);
      const data = await response.json();
      if (data.success) {
        this.csrfToken = data.data.csrfToken;
        this.csrfSession = data.data.sessionId;
      }
    } catch (e) {
      console.warn('Failed to fetch CSRF token:', e.message);
    }
  }

  setToken(accessToken, refreshToken) {
    this.token = accessToken;
    localStorage.setItem('auth_token', accessToken);
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem('refresh_token', refreshToken);
    }
  }

  clearToken() {
    this.token = '';
    this.refreshToken = '';
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    if (this.csrfSession) {
      headers['X-CSRF-Session'] = this.csrfSession;
    }
    return headers;
  }

  _processPendingRequests() {
    for (const [, { resolve, reject, fn }] of this._pendingRequests) {
      fn().then(resolve).catch(reject);
    }
    this._pendingRequests.clear();
  }

  async _requestWithRetry(path, options, retryCount) {
    try {
      return await this._executeRequest(path, options);
    } catch (error) {
      if (retryCount < this._maxRetries && error.status >= 500) {
        const delay = this._retryDelay * Math.pow(2, retryCount);
        await new Promise(r => setTimeout(r, delay));
        return this._requestWithRetry(path, options, retryCount + 1);
      }
      throw error;
    }
  }

  _onTokenRefreshed(newToken) {
    this._refreshSubscribers.forEach(cb => cb(newToken));
    this._refreshSubscribers = [];
  }

  _addRefreshSubscriber(callback) {
    this._refreshSubscribers.push(callback);
  }

  async _tryRefreshToken() {
    if (!this.refreshToken) return false;

    if (this._isRefreshing) {
      return new Promise((resolve) => {
        this._addRefreshSubscriber((newToken) => {
          resolve(!!newToken);
        });
      });
    }

    this._isRefreshing = true;

    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.setToken(data.data.accessToken, data.data.refreshToken);
        this._onTokenRefreshed(data.data.accessToken);
        return true;
      } else {
        this.clearToken();
        this._onTokenRefreshed(null);
        return false;
      }
    } catch (error) {
      this.clearToken();
      this._onTokenRefreshed(null);
      return false;
    } finally {
      this._isRefreshing = false;
    }
  }

  async request(path, options = {}) {
    if (!this._online && !path.includes('/auth/')) {
      throw new Error('网络连接已断开，请检查网络设置');
    }

    return this._requestWithRetry(path, options, 0);
  }

  async _executeRequest(path, options) {
    const url = `${API_BASE}${path}`;
    const config = {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    };

    if (options.body && typeof options.body === 'object' && options.method !== 'GET') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);

      if (response.status === 401 && !path.includes('/auth/')) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.code === 'TOKEN_EXPIRED') {
          const refreshed = await this._tryRefreshToken();
          if (refreshed) {
            config.headers = { ...this.getHeaders(), ...options.headers };
            if (options.body && typeof options.body === 'object') {
              config.body = JSON.stringify(options.body);
            }
            return this._executeRequest(path, options);
          } else {
            this.clearToken();
            if (window.app) {
              app.user = null;
              app.updateAuthUI(false);
              app.showAuthModal();
            }
            throw new Error('登录已过期，请重新登录');
          }
        }

        if (errorData.code === 'ACCOUNT_LOCKED') {
          throw new Error(errorData.error || '账户已被锁定');
        }
      }

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(data.error || '请求失败');
        error.code = data.code;
        error.status = response.status;
        error.quota = data.quota;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('网络连接失败，请检查网络设置');
      }
      throw error;
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  async register(email, username, password) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: { email, username, password }
    });
    if (data.data?.accessToken) {
      this.setToken(data.data.accessToken, data.data.refreshToken);
      this.user = data.data.user;
    }
    return data;
  }

  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    if (data.data?.accessToken) {
      this.setToken(data.data.accessToken, data.data.refreshToken);
      this.user = data.data.user;
    }
    return data;
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: this.refreshToken }
      });
    } catch (e) {
      // ignore
    }
    this.clearToken();
    this.user = null;
  }

  async logoutAll() {
    try {
      await this.request('/api/auth/logout-all', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    this.clearToken();
    this.user = null;
  }

  async getMe() {
    const data = await this.request('/api/auth/me');
    this.user = data.data;
    return data;
  }

  async updateProfile(updates) {
    const data = await this.request('/api/auth/me', {
      method: 'PUT',
      body: updates
    });
    if (data.data) {
      this.user = data.data;
    }
    return data;
  }

  async forgotPassword(email) {
    return this.request('/api/auth/forgot-password', {
      method: 'POST',
      body: { email }
    });
  }

  async resetPassword(token, password) {
    return this.request('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password }
    });
  }

  async getQuota() {
    return this.request('/api/generate/quota');
  }

  async generateImage(params) {
    return this.request('/api/generate/image', {
      method: 'POST',
      body: params
    });
  }

  async generateSpeech(params) {
    return this.request('/api/generate/speech', {
      method: 'POST',
      body: params
    });
  }

  async generateMusic(params) {
    return this.request('/api/generate/music', {
      method: 'POST',
      body: params
    });
  }

  async generateLyrics(params) {
    return this.request('/api/generate/lyrics', {
      method: 'POST',
      body: params
    });
  }

  async getWorks(options = {}) {
    const params = new URLSearchParams();
    if (options.type) params.append('type', options.type);
    if (options.page) params.append('page', options.page);
    if (options.limit) params.append('limit', options.limit);
    if (options.search) params.append('search', options.search);
    if (options.favorite) params.append('favorite', 'true');

    const query = params.toString();
    return this.request(`/api/works${query ? '?' + query : ''}`);
  }

  async getWork(id) {
    return this.request(`/api/works/${id}`);
  }

  async saveWork(work) {
    return this.request('/api/works', {
      method: 'POST',
      body: work
    });
  }

  async updateWork(id, updates) {
    return this.request(`/api/works/${id}`, {
      method: 'PUT',
      body: updates
    });
  }

  async deleteWork(id) {
    return this.request(`/api/works/${id}`, {
      method: 'DELETE'
    });
  }

  async deleteWorks(ids) {
    return this.request('/api/works/batch', {
      method: 'DELETE',
      body: { ids }
    });
  }

  async getWorksStats() {
    return this.request('/api/works/stats/summary');
  }
}

const backendApi = new BackendAPI();
