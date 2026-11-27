const API_BASE = window.location.origin;

class BackendAPI {
  constructor() {
    this.token = localStorage.getItem('auth_token') || '';
    this.refreshToken = localStorage.getItem('refresh_token') || '';
    this.csrfToken = '';
    this.csrfSession = '';
    this.user = null;
    this._authSession = { version: 0, refresh: null };
    this._online = navigator.onLine;
    this._pendingRequests = new Map();
    this._maxRetries = 3;
    this._retryDelay = 1000;
    this._requestTimeout = 120000;

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
      const { response, data } = await this._readJSON('/api/csrf-token');
      if (response.ok && data?.success) {
        this.csrfToken = data.data.csrfToken;
        this.csrfSession = data.data.sessionId;
      }
    } catch (e) {
      console.warn('Failed to fetch CSRF token:', e.message);
    }
  }

  setToken(accessToken, refreshToken) {
    this._authSession = { version: 0, refresh: null };
    this._storeTokens(accessToken, refreshToken);
  }

  _storeTokens(accessToken, refreshToken) {
    this.token = accessToken;
    this.refreshToken = refreshToken || '';
    if (this.token) localStorage.setItem('auth_token', this.token);
    else localStorage.removeItem('auth_token');
    if (this.refreshToken) localStorage.setItem('refresh_token', this.refreshToken);
    else localStorage.removeItem('refresh_token');
  }

  clearToken() {
    this.setToken('', '');
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

  async _tryRefreshToken(session, version) {
    if (this._authSession !== session) return false;
    // Another request may already have refreshed the token used by this one.
    if (session.version !== version) return true;
    if (!this.refreshToken) return false;
    if (!session.refresh) {
      session.refresh = this._refreshOnce(session).then(refreshed => {
        // A failed refresh may have rotated the server token before losing
        // its response. Keep its result until the session is invalidated.
        if (refreshed) session.refresh = null;
        return refreshed;
      });
    }
    return session.refresh;
  }

  async _refreshOnce(session) {
    try {
      const { response, data } = await this._readJSON('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      const accessToken = data?.data?.accessToken;
      if (this._authSession !== session || !response.ok || !data?.success
          || typeof accessToken !== 'string' || !accessToken) return false;
      this._storeTokens(accessToken, data.data.refreshToken || this.refreshToken);
      session.version += 1;
      return true;
    } catch {
      return false;
    }
  }

  _expireSession(session) {
    if (this._authSession !== session) return;
    this.clearToken();
    this.user = null;
    if (typeof app !== 'undefined' && app) {
      app.user = null;
      app.updateAuthUI(false);
      app.showAuthModal();
    }
  }

  async request(path, options = {}) {
    const authPath = path.includes('/auth/');
    if (!this._online && !authPath) {
      throw new Error('网络连接已断开，请检查网络设置');
    }

    const method = (options.method || 'GET').toUpperCase();
    const safeRead = method === 'GET' || method === 'HEAD';
    const config = { ...options, method };
    const canRefresh = !authPath && !Object.keys(options.headers || {}).some(
      name => name.toLowerCase() === 'authorization'
    );
    if (!safeRead && options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const session = this._authSession;
    let replayed = false;
    let retries = 0;
    let lastError;

    while (true) {
      config.signal?.throwIfAborted();
      if (this._authSession !== session) throw lastError;
      const version = session.version;
      try {
        return await this._executeRequest(path, config);
      } catch (error) {
        lastError = error;
        config.signal?.throwIfAborted();
        if (canRefresh && !replayed && error.status === 401 && error.code === 'TOKEN_EXPIRED') {
          replayed = true;
          if (await this._tryRefreshToken(session, version)) continue;
          this._expireSession(session);
          error.message = '登录已过期，请重新登录';
          throw error;
        }

        // Only reads can repeat after an ambiguous network or server failure.
        if (!safeRead || retries >= this._maxRetries || !(error.networkFailure || error.status >= 500)) {
          throw error;
        }
        const delay = this._retryDelay * Math.pow(2, retries++);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async _executeRequest(path, options) {
    const config = {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    };

    let response;
    let data;
    try {
      ({ response, data } = await this._readJSON(path, config));
    } catch (error) {
      if (!options.signal?.aborted && (error.name === 'TypeError' || error.name === 'NetworkError')) {
        const networkError = new Error('网络连接失败，请检查网络设置', { cause: error });
        networkError.networkFailure = true;
        throw networkError;
      }
      throw error;
    }

    if (response.ok) {
      if (options.method !== 'HEAD' && response.status !== 204
          && (!data || typeof data !== 'object' || Array.isArray(data))) {
        throw new Error('后台返回了无效的响应数据');
      }
      return data;
    }

    const fallback = response.status === 401 && data?.code === 'ACCOUNT_LOCKED'
      ? '账户已被锁定' : '请求失败';
    const error = new Error(data?.error || fallback);
    error.code = data?.code;
    error.status = response.status;
    error.quota = data?.quota;
    throw error;
  }

  async _readJSON(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._requestTimeout);
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    try {
      const response = await fetch(`${API_BASE}${path}`, { ...options, signal });
      if (response.ok && (options.method === 'HEAD' || response.status === 204)) {
        return { response, data: null };
      }
      const data = await response.json().catch(error => {
        if (signal.aborted || error.name !== 'SyntaxError') throw error;
        if (response.ok) throw new Error('后台返回了无效的响应数据', { cause: error });
        return null;
      });
      return { response, data };
    } catch (error) {
      if (signal.aborted && signal.reason === controller.signal.reason) {
        throw new Error('后台请求超时，结果未知', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
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
    return this.request(`/api/works/${encodeURIComponent(id)}`);
  }

  async saveWork(work) {
    return this.request('/api/works', {
      method: 'POST',
      body: work
    });
  }

  async updateWork(id, updates) {
    return this.request(`/api/works/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: updates
    });
  }

  async deleteWork(id) {
    return this.request(`/api/works/${encodeURIComponent(id)}`, {
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
