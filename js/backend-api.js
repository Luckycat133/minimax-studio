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

// Same-origin operation client. POST is sent once; reconnect uses only GET.
class StudioOperationAPI {
  constructor({ request = (...args) => fetch(...args), wait = StudioOperationAPI.sleep, createId, storage, timeout = 3000, now = Date.now,
    loadWav = () => import('./production-core.mjs') } = {}) {
    this.request = request;
    this.wait = wait;
    this.createId = createId || (() => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2,'0')).join(''));
    this.storage = storage;
    this.current = this._readStored('minimax_studio_operation');
    this.last = this._readStored('minimax_studio_result');
    this.timeout = timeout;
    this.now = now;
    this.loadWav = loadWav;
  }

  static sleep(ms, signal) {
    return new Promise((resolve,reject)=>{
      signal?.throwIfAborted();
      const finish = () => { signal?.removeEventListener('abort',abort); resolve(); };
      const timer = setTimeout(finish,ms);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort',abort,{once:true});
    });
  }

  remember(id) {
    this.current = id;
    this._store('minimax_studio_operation', id);
  }

  rememberResult(id) {
    this.last = id;
    this._store('minimax_studio_result', id);
  }

  remembered() { return this.current; }

  _store(key, value) {
    try { if(value) this.storage?.setItem(key,value); else this.storage?.removeItem(key); } catch {}
  }

  _readStored(key) {
    try { const id = this.storage?.getItem(key); return /^[0-9a-f]{32}$/.test(id) ? id : null; }
    catch { return null; }
  }

  _deadline(signal) {
    const deadline = AbortSignal.timeout(this.timeout);
    return signal ? AbortSignal.any([signal, deadline]) : deadline;
  }

  _retryAfter(header) {
    if (!header) return null;
    const value = header.trim();
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    // Ignore free-form values such as "1.5" that Date.parse may treat as dates.
    if (!/^[A-Za-z]{3}, .* GMT$/.test(value)) return null;
    const until = Date.parse(value);
    return Number.isFinite(until) ? Math.max(0, until - this.now()) : null;
  }

  _responseError(res) {
    // A reverse proxy may emit an HTML body. Classify the HTTP status first,
    // discard its body, and never reflect untrusted gateway text into the UI.
    void res.body?.cancel().catch(() => {});
    const messages = {
      404: '本地任务不存在或已过期',
      429: '本地后台暂时限流；请稍后恢复已有任务',
      502: '本地后台网关暂不可用；可恢复已有任务',
      504: '本地后台网关超时；可恢复已有任务'
    };
    return Object.assign(new Error(messages[res.status] || '本地后台请求失败'), {
      status: res.status,
      retryAfterMs: res.status === 429 ? this._retryAfter(res.headers.get('retry-after')) : null
    });
  }

  async _request(path, init = {}, signal) {
    const combined = this._deadline(signal);
    const res = await this.request(path, {
      ...init, signal: combined, cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers }
    });
    if (!res.ok) throw this._responseError(res);
    const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      void res.body?.cancel().catch(() => {});
      throw new Error('本地后台返回无效响应');
    }
    return res.json();
  }

  async downloadAudio(id, advertisedUrl, signal) {
    const path = this._path(id) + '/download';
    if (advertisedUrl !== path) throw new Error('本地音频地址无效');
    signal?.throwIfAborted();
    const { validateWav, MAX_AUDIO_BYTES } = await this.loadWav();
    const combined = this._deadline(signal);
    combined.throwIfAborted();
    const res = await this.request(path, {
      signal: combined, cache: 'no-store', redirect: 'error', headers: { Accept: 'audio/wav' }
    });
    if (!res.ok) throw this._responseError(res);
    const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const length = res.headers.get('content-length');
    const encoding = res.headers.get('content-encoding');
    if (res.status !== 200 || type !== 'audio/wav' || !res.body
        || (encoding && encoding !== 'identity')
        || (length !== null && (!/^\d+$/.test(length) || +length < 44 || +length > MAX_AUDIO_BYTES))) {
      void res.body?.cancel().catch(() => {});
      throw new Error('本地音频响应不完整；可恢复已有任务');
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_AUDIO_BYTES || (length !== null && received > +length)) {
          throw new Error('音频字节数超出范围');
        }
        chunks.push(value);
      }
      combined.throwIfAborted();
      if (length !== null && received !== +length) throw new Error('音频传输长度不符');
      const data = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      validateWav(data);
      return new Blob([data], {type: 'audio/wav'});
    } catch {
      void reader.cancel().catch(() => {});
      signal?.throwIfAborted();
      throw new Error('本地音频下载中断或校验失败；可恢复已有任务');
    } finally {
      reader.releaseLock();
    }
  }

  async start(modality, params, signal) {
    const id = this.createId();
    this.remember(id); // operation handle only; never a credential or prompt
    let state;
    try {
      state = await this._request('/api/studio/operations',{
        method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({id,modality,params})
      },signal);
    } catch (error) {
      // A timeout/cancel may have occurred after acceptance. Never issue another POST.
      if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) this.remember(null);
      throw error;
    }
    return this.poll(id,signal,state);
  }

  async poll(id, signal, initial) {
    const path = this._path(id);
    let state = initial;
    for(let attempt=0; attempt<=12; attempt++) {
      signal?.throwIfAborted();
      let retryAfter = 0;
      if (!state) {
        try { state = await this._request(path,{},signal); }
        catch(error) {
          signal?.throwIfAborted();
          const transient = [408, 429, 500, 502, 503, 504].includes(error.status)
            || ['TypeError', 'NetworkError', 'TimeoutError', 'AbortError'].includes(error.name);
          if (!transient || error.retryAfterMs > 10000) throw error;
          // Only bounded reads repeat, never POST. Respect Retry-After or stop
          // if waiting that long exceeds this automatic recovery contract.
          retryAfter = error.retryAfterMs ?? 0;
        }
      }
      if (state) {
        if (state.id !== id || !['pending','completed','cancelled'].includes(state.status)) throw new Error('后台任务状态无效');
        if (state.status !== 'pending') return state;
      }
      if (attempt === 12) break;
      state = null;
      await this.wait(Math.max(retryAfter, Math.min(300 * (2 ** attempt), 2400)),signal);
    }
    throw new Error('等待后台结果超时；可恢复已有任务，不会重复提交');
  }

  cancel(id) { return this._request(this._path(id),{method:'DELETE'}); }

  _path(id) {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('无效后台任务 ID');
    return `/api/studio/operations/${id}`;
  }
}
