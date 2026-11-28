const LOCAL_WORKBENCH_MODELS = new Set(['image', 'speech', 'music', 'lyrics', 'chat', 'video']);
const AVAILABLE_MODELS = new Set(['image', 'speech', 'music', 'lyrics']);

class App {
  constructor() {
    this.currentModel = 'image';
    this.isGenerating = false;
    this.uploadedImageData = null;
    this.user = null;
    this.quota = null;
    this._blobUrls = [];
    this._authMode = 'login';
    this.mode = WORKBENCH_MODE.UNAVAILABLE;
    this.modeReady = false;
    this.localStudio = null;
    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    this.renderConfigPanel();
    await this.detectMode();
    this.modeReady = true;
    if (this.localStudio) this.updateStudioActions();
    else this.generateBtn.disabled = !this.backendReady && !this.directMode;
    if (this.user && !this.directMode && !this.localStudio) {
      await this.loadQuota();
    }
  }

  get directMode() {
    return this.mode === WORKBENCH_MODE.DIRECT_EXPERIMENT;
  }

  get backendReady() {
    return this.mode === WORKBENCH_MODE.CONTROLLED_FIXTURE ||
      this.mode === WORKBENCH_MODE.LEGACY_BACKEND;
  }

  async detectMode() {
    this.mode = await resolveWorkbenchMode(location);
    switch (this.mode) {
      case WORKBENCH_MODE.DIRECT_EXPERIMENT:
        this.updateDirectKeyUI();
        this.showApiKeyModal();
        return;
      case WORKBENCH_MODE.CONTROLLED_FIXTURE:
        this.connectControlledFixture();
        return;
      case WORKBENCH_MODE.LEGACY_BACKEND:
        await this.checkAuth();
        return;
      default:
        this.apiStatus.textContent = '本地后台不可用 · 请用 npm run studio 启动';
    }
  }

  connectControlledFixture() {
    let storage;
    try { storage = window.sessionStorage; } catch {}
    this.localStudio = new StudioOperationAPI({storage});
    this.apiStatus.textContent = '本地后台 · 演示数据（零额度）';
    this.navItems.forEach(item => { item.disabled = !LOCAL_WORKBENCH_MODELS.has(item.dataset.model); });
    this.updateStudioActions();
  }

  showApiKeyModal() {
    if (!this.directMode) return;
    this.apiKeyError.textContent = '';
    this.apiKeyModal.classList.add('open');
    this.apiKeyInput.focus();
  }

  closeApiKeyModal() {
    if (!this.apiKeyModal.classList.contains('open')) return;
    this.apiKeyInput.value = '';
    this.apiKeyModal.classList.remove('open');
    this.generateBtn.focus();
  }

  bindApiKeyEvents() {
    document.getElementById('apikey-modal-backdrop').addEventListener('click', () => this.closeApiKeyModal());
    document.getElementById('apikey-modal-close').addEventListener('click', () => this.closeApiKeyModal());
    document.getElementById('apikey-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!this.directMode) return;
      const key = this.apiKeyInput.value.trim();
      if (!key) {
        this.apiKeyError.textContent = '请输入 API Key';
        return;
      }
      try {
        api.setApiKey(key);
      } catch {
        this.apiKeyError.textContent = '当前页面无法配置 API Key';
        return;
      }
      this.updateDirectKeyUI();
      this.closeApiKeyModal();
      Utils.showToast('API Key 仅在本页有效', 'success');
    });
  }

  updateDirectKeyUI() {
    const hasKey = Boolean(api.getApiKey());
    this.user = hasKey ? { username: '直连模式' } : null;
    document.getElementById('my-works-btn').hidden = true;
    document.getElementById('logout-btn').textContent = '清除 API Key';
    this.updateAuthUI(hasKey);
  }

  bindElements() {
    this.navItems = document.querySelectorAll('.nav-item');
    this.configPanel = document.getElementById('config-panel');
    this.generateBtn = document.getElementById('generate-btn');
    this.studioCancel = document.getElementById('studio-cancel');
    this.studioResume = document.getElementById('studio-resume');
    this.resetBtn = document.getElementById('reset-btn');
    this.resultPanel = document.getElementById('result-panel');
    this.resultEmpty = document.getElementById('result-empty');
    this.resultContent = document.getElementById('result-content');
    this.headerTitle = document.getElementById('header-title');
    this.headerDesc = document.getElementById('header-desc');
    this.emptyIcon = document.getElementById('empty-icon');
    this.apiStatus = document.getElementById('api-status');
    this.apiKeyModal = document.getElementById('apikey-modal');
    this.apiKeyInput = document.getElementById('apikey-input');
    this.apiKeyError = document.getElementById('apikey-error');
    this.lightbox = document.getElementById('image-lightbox');
    this.lightboxImage = document.getElementById('lightbox-image');
    this.lightboxClose = document.getElementById('lightbox-close');
    this.mobileMenuBtn = document.getElementById('mobile-menu-btn');
    this.sidebar = document.querySelector('.sidebar');
    this.authModal = document.getElementById('auth-modal');
    this.quotaDisplay = document.getElementById('quota-display');
    this.userMenu = document.getElementById('user-menu');
    this.worksModal = document.getElementById('works-modal');
    this.worksModalBackdrop = document.getElementById('works-modal-backdrop');
    this.worksModalClose = document.getElementById('works-modal-close');
  }

  bindEvents() {
    this.navItems.forEach(item => {
      item.addEventListener('click', () => {
        if (!this.switchModel(item.dataset.model)) return;
        this.sidebar.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('active');
      });
    });

    this.generateBtn.addEventListener('click', () => this.handleGenerate());
    this.studioCancel.addEventListener('click', () => void this.cancelStudioOperation());
    this.studioResume.addEventListener('click', () => void this.resumeStudioOperation());
    this.resetBtn.addEventListener('click', () => this.resetParams());

    if (this.lightboxClose) {
      this.lightboxClose.addEventListener('click', () => this.closeLightbox());
    }
    if (this.lightbox) {
      this.lightbox.addEventListener('click', (e) => {
        if (e.target === this.lightbox) this.closeLightbox();
      });
    }
    if (this.mobileMenuBtn) {
      this.mobileMenuBtn.addEventListener('click', () => {
        this.sidebar.classList.toggle('open');
        document.getElementById('sidebar-overlay')?.classList.toggle('active');
      });
    }

    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        this.sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeLightbox();
        this.closeApiKeyModal();
        this.closeAuthModal();
        this.closeWorksModal();
      }
    });

    const logoutBtn = document.getElementById('logout-btn');
    const myWorksBtn = document.getElementById('my-works-btn');

    if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout());
    if (myWorksBtn) myWorksBtn.addEventListener('click', () => this.showWorksModal());
    if (this.worksModalBackdrop) this.worksModalBackdrop.addEventListener('click', () => this.closeWorksModal());
    if (this.worksModalClose) this.worksModalClose.addEventListener('click', () => this.closeWorksModal());
    this.worksModal.addEventListener('click', event => {
      const button = event.target.closest('[data-work-action]');
      const work = button?.closest('.work-item');
      if (!work) return;
      const id = decodeURIComponent(work.dataset.id);
      switch (button.dataset.workAction) {
        case 'view': this.viewWork(id); break;
        case 'delete': this.deleteWork(id); break;
        case 'favorite': this.toggleFavorite(id, button.dataset.favorite === 'true'); break;
      }
    });

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    this._initTheme();

    const userMenuToggle = document.getElementById('user-menu-toggle');
    const userDropdown = document.getElementById('user-dropdown');
    if (userMenuToggle && userDropdown) {
      userMenuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('show');
      });
      document.addEventListener('click', () => {
        userDropdown.classList.remove('show');
      });
    }

    this.bindAuthEvents();
    this.bindApiKeyEvents();
  }

  bindAuthEvents() {
    const authModal = this.authModal;
    if (!authModal) return;

    const authCloseBtn = document.getElementById('auth-modal-close');
    const authBackdrop = authModal.querySelector('.modal-backdrop');
    const authForm = document.getElementById('auth-form');
    const authSwitchLink = document.getElementById('auth-switch-link');

    if (authCloseBtn) {
      authCloseBtn.addEventListener('click', () => this.closeAuthModal());
    }
    if (authBackdrop) {
      authBackdrop.addEventListener('click', () => this.closeAuthModal());
    }
    if (authForm) {
      authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAuthSubmit();
      });
    }
    if (authSwitchLink) {
      authSwitchLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleAuthMode();
      });
    }
  }

  async checkAuth() {
    if (backendApi.isAuthenticated()) {
      try {
        const result = await backendApi.getMe();
        this.user = result.data;
        this.updateAuthUI(true);
        return;
      } catch (error) {
        backendApi.clearToken();
      }
    }
    this.user = null;
    this.updateAuthUI(false);
    this.showAuthModal();
  }

  showAuthModal() {
    if (!this.authModal) return;
    this._authMode = 'login';
    this.updateAuthModalUI();
    this.authModal.classList.add('open');
  }

  closeAuthModal() {
    if (this.authModal) {
      this.authModal.classList.remove('open');
    }
  }

  toggleAuthMode() {
    this._authMode = this._authMode === 'login' ? 'register' : 'login';
    this.updateAuthModalUI();
  }

  updateAuthModalUI() {
    const title = document.getElementById('auth-modal-title');
    const usernameGroup = document.getElementById('auth-username-group');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    const errorEl = document.getElementById('auth-error');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const usernameInput = document.getElementById('auth-username');

    if (errorEl) errorEl.textContent = '';
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (usernameInput) usernameInput.value = '';

    if (this._authMode === 'login') {
      if (title) title.textContent = '登录';
      if (usernameGroup) usernameGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = '登录';
      if (switchText) switchText.textContent = '还没有账号？';
      if (switchLink) switchLink.textContent = '注册';
    } else {
      if (title) title.textContent = '注册';
      if (usernameGroup) usernameGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = '注册';
      if (switchText) switchText.textContent = '已有账号？';
      if (switchLink) switchLink.textContent = '登录';
    }
  }

  async handleAuthSubmit() {
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const username = document.getElementById('auth-username')?.value?.trim();
    const errorEl = document.getElementById('auth-error');

    if (!email || !password) {
      if (errorEl) errorEl.textContent = '请填写邮箱和密码';
      return;
    }

    try {
      let result;
      if (this._authMode === 'login') {
        result = await backendApi.login(email, password);
      } else {
        if (!username || username.length < 3) {
          if (errorEl) errorEl.textContent = '用户名至少3个字符';
          return;
        }
        if (password.length < 8) {
          if (errorEl) errorEl.textContent = '密码至少8位，需包含大小写字母、数字和特殊字符';
          return;
        }
        result = await backendApi.register(email, username, password);
      }

      this.user = result.data.user;
      this.updateAuthUI(true);
      this.closeAuthModal();
      await this.loadQuota();
      Utils.showToast(this._authMode === 'login' ? '登录成功' : '注册成功', 'success');
    } catch (error) {
      if (error.code === 'ACCOUNT_LOCKED') {
        if (errorEl) errorEl.textContent = error.message;
      } else {
        if (errorEl) errorEl.textContent = error.message || '操作失败';
      }
    }
  }

  updateAuthUI(isAuthenticated) {
    const userMenu = document.getElementById('user-menu');
    const userName = document.getElementById('user-name');

    if (userMenu) {
      userMenu.style.display = isAuthenticated ? 'flex' : 'none';
      if (userName && this.user) userName.textContent = this.user.username || '用户';
    }

    this.updateApiStatus();
  }

  async loadQuota() {
    if (!this.user || this.directMode) return;

    try {
      const result = await backendApi.getQuota();
      this.quota = result.data;
      this.renderQuotaDisplay();
    } catch (error) {
      console.error('Failed to load quota:', error.message);
    }
  }

  renderQuotaDisplay() {
    if (!this.quota || !this.quotaDisplay) return;
    this.quotaDisplay.innerHTML = Templates.quotaDisplay(this.quota);
  }

  async handleLogout() {
    if (this.isGenerating) {
      Utils.showToast('请等待当前生成结束', 'info');
      return;
    }
    if (this.directMode) {
      try {
        api.setApiKey('');
      } catch {
        Utils.showToast('当前浏览器无法清除 API Key', 'error');
        return;
      }
      this.updateDirectKeyUI();
      this.showApiKeyModal();
      Utils.showToast('API Key 已清除', 'info');
      return;
    }
    await backendApi.logout();
    this.user = null;
    this.quota = null;
    this.updateAuthUI(false);
    if (this.quotaDisplay) this.quotaDisplay.innerHTML = '';
    this.showAuthModal();
    Utils.showToast('已退出登录', 'info');
  }

  async showWorksModal() {
    if (!this.user) return;

    this.worksModal.classList.add('open');
    const worksContent = document.getElementById('works-content');

    if (this.directMode) {
      worksContent.innerHTML = `<div class="works-empty"><span class="works-empty-icon">📁</span><p>直接模式下作品管理功能不可用</p><p style="color:var(--text-muted);font-size:13px;margin-top:8px;">登录账号后可保存并管理历史作品</p></div>`;
      return;
    }

    worksContent.innerHTML = '<div class="loading-spinner"></div><p>加载中...</p>';

    try {
      const result = await backendApi.getWorks({ limit: 50 });
      this.renderWorksList(result.data.works);
    } catch (error) {
      worksContent.innerHTML = `<div class="error-message">${Utils.sanitizeHtml(error.message)}</div>`;
    }
  }

  renderWorksList(works) {
    document.getElementById('works-content').innerHTML = Templates.worksList(works);
    this._allWorks = works;
  }

  async filterWorks(type) {
    if (!this._allWorks) return;
    const filtered = type ? this._allWorks.filter(w => w.work_type === type) : this._allWorks;
    this.renderWorksList(filtered);
  }

  searchWorks(query) {
    if (!this._allWorks) return;
    const q = query.toLowerCase();
    const filtered = this._allWorks.filter(w =>
      (w.title && w.title.toLowerCase().includes(q)) ||
      (w.prompt && w.prompt.toLowerCase().includes(q))
    );
    this.renderWorksList(filtered);
  }

  async viewWork(id) {
    try {
      const result = await backendApi.getWork(id);
      const work = result.data;

      this.closeWorksModal();
      if (!this.switchModel(work.work_type)) return;

      if (work.result_url || work.result_data) {
        this.renderStoredWork(work);
      }
    } catch (error) {
      Utils.showToast(error.message, 'error');
    }
  }

  async toggleFavorite(id, isFavorite) {
    try {
      await backendApi.updateWork(id, { is_favorite: isFavorite });
      if (this._allWorks) {
        const work = this._allWorks.find(w => String(w.id) === id);
        if (work) work.is_favorite = isFavorite;
        this.renderWorksList(this._allWorks);
      }
      Utils.showToast(isFavorite ? '已收藏' : '已取消收藏', 'success');
    } catch (error) {
      Utils.showToast(error.message, 'error');
    }
  }

  renderStoredWork(work) {
    this.revokeBlobUrls();
    this.resultEmpty.style.display = 'none';
    this.resultContent.style.display = 'block';

    try {
      if (work.work_type === 'image') {
        const images = work.result_data ? JSON.parse(work.result_data) : [work.result_url];
        this.renderImageResult({ images, metadata: work.metadata || {} }, work.params || {});
      } else if (work.work_type === 'speech' || work.work_type === 'music') {
        this.renderAudioResult({
          audio: work.result_data,
          audioUrl: work.result_url,
          extraInfo: work.metadata || {}
        }, work.params || {}, work.work_type);
      } else if (work.work_type === 'lyrics') {
        const meta = work.metadata || {};
        this.renderLyricsResult({
          title: meta.title || '',
          styleTags: meta.styleTags || '',
          lyrics: work.result_data || ''
        });
      }
    } catch (error) {
      this.renderError('加载作品数据失败');
    }
  }

  async deleteWork(id) {
    if (!confirm('确定要删除这个作品吗？')) return;

    try {
      await backendApi.deleteWork(id);
      Utils.showToast('作品已删除', 'success');
      this._allWorks = this._allWorks.filter(w => String(w.id) !== id);
      this.renderWorksList(this._allWorks);
    } catch (error) {
      Utils.showToast(error.message, 'error');
    }
  }

  closeWorksModal() {
    this.worksModal.classList.remove('open');
  }

  updateApiStatus() {
    const dot = this.apiStatus?.querySelector('.status-dot');
    const text = this.apiStatus?.querySelector('span:last-child');
    if (this.directMode) {
      dot.className = 'status-dot';
      text.textContent = this.user ? '直连 · 本页已配置密钥' : '直连 · 未配置密钥';
    } else {
      dot.className = this.user ? 'status-dot connected' : 'status-dot disconnected';
      text.textContent = this.user ? '后台模式 · 已登录' : '后台模式 · 未登录';
    }
  }

  switchModel(modelId) {
    if (this.isGenerating || !(this.localStudio ? LOCAL_WORKBENCH_MODELS : AVAILABLE_MODELS).has(modelId)) return false;
    this.currentModel = modelId;
    this.uploadedImageData = null;
    this.revokeBlobUrls();
    const config = MODEL_CONFIGS[modelId];
    this.headerTitle.textContent = `${config.icon} ${config.name}`;
    this.headerDesc.textContent = config.description;
    this.emptyIcon.textContent = config.icon;
    this.renderConfigPanel();
    this.showEmpty();
    this.navItems.forEach(item => item.classList.toggle('active', item.dataset.model === modelId));
    return true;
  }

  renderConfigPanel() {
    const config = MODEL_CONFIGS[this.currentModel];
    const advancedKeys = ['seed', 'prompt_optimizer', 'aigc_watermark', 'style_type', 'style_weight', 'language_boost', 'output_format', 'subtitle_enable', 'lyrics_optimizer', 'is_instrumental', 'bitrate', 'sample_rate', 'audio_format', 'response_format', 'subject_reference_image'];
    this.configPanel.innerHTML = Templates.configPanel(config.params, advancedKeys);
    this.bindConfigEvents();
  }

  bindConfigEvents() {
    this.configPanel.querySelectorAll('.param-range').forEach(range => {
      range.addEventListener('input', () => {
        const display = this.configPanel.querySelector(`[data-range-display="${range.dataset.key}"]`);
        if (display) display.textContent = range.value;
      });
    });

    this.configPanel.querySelectorAll('.param-textarea').forEach(textarea => {
      textarea.addEventListener('input', () => {
        const counter = this.configPanel.querySelector(`[data-count-for="${textarea.dataset.key}"]`);
        if (counter) {
          const len = textarea.value.length;
          const max = parseInt(textarea.getAttribute('maxlength'));
          counter.textContent = `${len} / ${max}`;
          counter.className = 'char-count' + (len > max * 0.9 ? ' error' : len > max * 0.7 ? ' warning' : '');
        }
      });
    });

    this.configPanel.querySelectorAll('.param-select, .param-checkbox input').forEach(el => {
      el.addEventListener('change', () => this.updateConditionalFields());
    });

    this.configPanel.querySelectorAll('.file-upload-area').forEach(area => {
      const input = area.previousElementSibling;
      area.addEventListener('click', () => input.click());
      area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.style.borderColor = 'var(--accent-primary)';
      });
      area.addEventListener('dragleave', () => {
        area.style.borderColor = '';
      });
      area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.style.borderColor = '';
        if (e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          this.handleFileUpload(input);
        }
      });
      input.addEventListener('change', () => this.handleFileUpload(input));
    });

    this.updateConditionalFields();
  }

  handleFileUpload(input) {
    const key = input.dataset.key;
    const area = input.nextElementSibling;
    const file = input.files[0];
    if (!file) return;

    const config = MODEL_CONFIGS[this.currentModel];
    const paramConfig = config.params[key];
    if (paramConfig.maxSize && file.size > paramConfig.maxSize) {
      Utils.showToast('文件大小超过限制', 'error');
      return;
    }

    area.classList.add('has-file');
    area.innerHTML = '';

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedImageData = e.target.result;
        area.innerHTML = `
          <img src="${e.target.result}" class="file-upload-preview" alt="preview">
          <span class="file-upload-name">${Utils.sanitizeHtml(file.name)}</span>
        `;
      };
      reader.readAsDataURL(file);
    } else {
      area.innerHTML = `<span class="file-upload-name">${Utils.sanitizeHtml(file.name)}</span>`;
    }
  }

  updateConditionalFields() {
    this.configPanel.querySelectorAll('.param-group[data-condition-field]').forEach(group => {
      const condField = group.dataset.conditionField;
      const condValue = group.dataset.conditionValue;
      const currentEl = this.configPanel.querySelector(`[data-key="${condField}"]`);
      if (!currentEl) return;

      let currentVal;
      if (currentEl.type === 'checkbox') {
        currentVal = currentEl.checked ? 'true' : 'false';
      } else {
        currentVal = currentEl.value;
      }

      if (currentVal === condValue) {
        group.classList.remove('hidden');
      } else {
        group.classList.add('hidden');
      }
    });
  }

  getParams() {
    const params = {};
    this.configPanel.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      if (el.type === 'checkbox') {
        params[key] = el.checked;
      } else if (el.type === 'file') {
        // handled separately
      } else if (el.type === 'range') {
        params[key] = parseFloat(el.value);
      } else if (el.type === 'number') {
        params[key] = Number(el.value);
      } else {
        params[key] = el.value;
      }
    });
    if (this.uploadedImageData) {
      params.subject_reference_image = this.uploadedImageData;
    }
    return params;
  }

  resetParams() {
    const config = MODEL_CONFIGS[this.currentModel];
    this.uploadedImageData = null;
    this.configPanel.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const paramConfig = config.params[key];
      if (el.type === 'checkbox') {
        el.checked = paramConfig.default || false;
      } else if (el.type === 'range') {
        el.value = paramConfig.default || 0;
        const display = this.configPanel.querySelector(`[data-range-display="${key}"]`);
        if (display) display.textContent = el.value;
      } else if (el.type === 'file') {
        el.value = '';
        const area = el.nextElementSibling;
        area.classList.remove('has-file');
        area.innerHTML = `<span class="file-upload-icon">📁</span><span class="file-upload-text">点击或拖拽上传图片</span>`;
      } else {
        el.value = paramConfig.default || '';
      }
    });
    this.configPanel.querySelectorAll('.char-count').forEach(c => {
      const max = c.textContent.split('/')[1]?.trim();
      if (max) c.textContent = `0 / ${max}`;
    });
    this.updateConditionalFields();
    Utils.showToast('参数已重置', 'info');
  }

  showEmpty() {
    this.resultEmpty.style.display = 'flex';
    this.resultContent.style.display = 'none';
    this.resultContent.innerHTML = '';
  }

  revokeBlobUrls() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls = [];
  }

  createBlobUrl(blob) {
    const url = URL.createObjectURL(blob);
    this._blobUrls.push(url);
    return url;
  }

  async handleGenerate() {
    if (!this.modeReady || (!this.backendReady && !this.directMode) || this._cancellingStudio || this.isGenerating || !(this.localStudio ? LOCAL_WORKBENCH_MODELS : AVAILABLE_MODELS).has(this.currentModel)) return;
    if (!this.user && !this.localStudio) {
      if (this.directMode) {
        this.showApiKeyModal();
      } else {
        this.showAuthModal();
      }
      return;
    }

    const params = this.getParams();
    const config = MODEL_CONFIGS[this.currentModel];

    const requiredParams = Object.entries(config.params).filter(([k, v]) => v.required);
    for (const [key, param] of requiredParams) {
      const val = params[key];
      if (!val || (typeof val === 'string' && !val.trim())) {
        if (param.condition) {
          const condEl = this.configPanel.querySelector(`[data-key="${param.condition.field}"]`);
          if (condEl && condEl.value !== param.condition.value) continue;
        }
        Utils.showToast(`请填写必填参数：${param.label}`, 'warning');
        return;
      }
    }

    if (params.mode === 'i2i' && !this.uploadedImageData) {
      Utils.showToast('图生图模式需要上传参考图片', 'warning');
      return;
    }

    if (this.localStudio) {
      if (this.localStudio.remembered()) {
        Utils.showToast('请先恢复或取消上一个后台任务', 'warning');
        return;
      }
      await this.runStudioOperation(signal => this.localStudio.start(this.currentModel,params,signal));
      return;
    }

    this.isGenerating = true;
    this.generateBtn.disabled = true;
    this.generateBtn.innerHTML = '<span class="loading-spinner" style="width:18px;height:18px;border-width:2px;margin:0;"></span><span>生成中...</span>';

    const loadingOverlay = Utils.createLoadingOverlay(Templates.generationProgress(this.currentModel));
    document.querySelector('.workspace').style.position = 'relative';
    document.querySelector('.workspace').appendChild(loadingOverlay);

    try {
      let result;

      if (this.directMode) {
        result = await this.handleDirectGenerate(params);
      } else {
        switch (this.currentModel) {
          case 'image':
            result = await backendApi.generateImage(params);
            break;
          case 'speech':
            result = await backendApi.generateSpeech(params);
            break;
          case 'music':
            result = await backendApi.generateMusic(params);
            break;
          case 'lyrics':
            result = await backendApi.generateLyrics(params);
            break;
        }
        await this.loadQuota();
      }

      if (this.directMode) {
        if (result.success === false) {
          this.renderError(result.error);
          Utils.showToast(result.error || '生成失败', 'error');
        } else {
          this.renderDirectResult(result, params);
          Utils.showToast('生成成功！', 'success');
        }
      } else if (result.success) {
        const resultData = result.data;
        this.renderResult(resultData, params);

        if (this.user) {
          await this.saveWorkToBackend(params, resultData);
        }

        Utils.showToast('生成成功！', 'success');
      } else {
        this.renderError(result.error);
        Utils.showToast(result.error || '生成失败', 'error');
      }
    } catch (error) {
      const msg = error.message || '生成失败';

      if (!this.directMode && error.quota) {
        this.renderQuotaError(error);
      } else {
        this.renderError(msg);
      }

      Utils.showToast(msg, 'error');
    } finally {
      this.isGenerating = false;
      this.generateBtn.disabled = false;
      this.generateBtn.innerHTML = '<span class="btn-icon">✨</span><span>开始生成</span>';
      if (loadingOverlay._cleanup) loadingOverlay._cleanup();
      loadingOverlay.remove();
    }
  }

  updateStudioActions() {
    if (!this.localStudio) return;
    const recoverable = Boolean(this.localStudio.remembered());
    this.studioCancel.hidden = !recoverable;
    this.studioResume.hidden = !(recoverable || this.localStudio.last) || this.isGenerating;
    this.generateBtn.disabled = this.isGenerating || recoverable;
  }

  async runStudioOperation(action) {
    this.isGenerating = true;
    const controller = new AbortController();
    this.studioController = controller;
    let state, audio;
    try {
      const pending = action(controller.signal);
      this.updateStudioActions();
      state = await pending;
      if (state.status === 'completed' && ['speech', 'music'].includes(state.modality)) {
        audio = await this.localStudio.downloadAudio(state.id, state.result?.audioUrl, controller.signal);
      }
      controller.signal.throwIfAborted();
    } catch(error) {
      state = null; // Do not expose a playable/downloadable partial WAV.
      if (error.status === 404) {
        if (this.localStudio.remembered()) this.localStudio.remember(null);
        else this.localStudio.rememberResult(null);
      }
      if (!controller.signal.aborted) this.renderError(error.message || '本地任务未完成');
    } finally {
      this.isGenerating = false;
      this.studioController = null;
    }
    try { if (state) this.showStudioState(state, audio); }
    catch(error) { this.renderError(error.message || '本地结果无效'); }
    this.updateStudioActions();
  }

  showStudioState(state, audio) {
    if (state.status === 'cancelled') {
      this.localStudio.remember(null);
      this.showEmpty();
      Utils.showToast('本地任务已取消','info');
      return;
    }
    if (state.status !== 'completed' || !LOCAL_WORKBENCH_MODELS.has(state.modality)) return;
    if (state.modality !== this.currentModel) this.switchModel(state.modality);
    this.renderResult(state.result,{},audio);
    this.localStudio.rememberResult(state.id);
    this.localStudio.remember(null);
    Utils.showToast('已取得本地演示结果','success');
  }

  async resumeStudioOperation() {
    const id = this.localStudio?.remembered() || this.localStudio?.last;
    if (id && !this.isGenerating && !this._cancellingStudio) await this.runStudioOperation(signal => this.localStudio.poll(id,signal));
  }

  async cancelStudioOperation() {
    const id = this.localStudio?.remembered();
    if (!id || this._cancellingStudio) return;
    this._cancellingStudio = true;
    try {
      // The server result decides whether cancellation or completion won.
      const state = await this.localStudio.cancel(id);
      if (state.status === 'cancelled') this.studioController?.abort();
      // During a poll, if completion won, let the existing operation render once.
      if (state.status === 'cancelled') this.showStudioState(state);
      else if (!this.isGenerating) await this.runStudioOperation(() => Promise.resolve(state));
    } catch(error) {
      // A cancel can race the original upload. Retain the ID on ambiguous errors.
      if (error.status === 404 && !this.isGenerating) this.localStudio.remember(null);
      this.renderError(error.message || '取消结果未知');
    } finally {
      this._cancellingStudio = false;
      this.updateStudioActions();
    }
  }

  async handleDirectGenerate(params) {
    switch (this.currentModel) {
      case 'image':
        return await api.generateImage(params);
      case 'speech':
        return await api.synthesizeSpeech(params);
      case 'music':
        return await api.generateMusic(params);
      case 'lyrics':
        return await api.generateLyrics(params);
    }
  }

  renderDirectResult(result, params) {
    this.resultEmpty.style.display = 'none';
    this.resultContent.style.display = 'block';
    this.revokeBlobUrls();

    switch (this.currentModel) {
      case 'image':
        this.renderImageResult(result, params);
        break;
      case 'speech':
      case 'music':
        this.renderAudioResult(result, params);
        break;
      case 'lyrics':
        this.renderLyricsResult(result);
        break;
    }
  }

  async saveWorkToBackend(params, result) {
    if (this.directMode) return;
    try {
      const workData = {
        work_type: this.currentModel,
        prompt: params.prompt || params.text || '',
        params: params,
        metadata: result.extraInfo || result.metadata || {}
      };

      if (this.currentModel === 'image') {
        workData.result_data = JSON.stringify(result.images);
      } else if (this.currentModel === 'lyrics') {
        workData.result_data = result.lyrics;
        workData.metadata = { title: result.title, styleTags: result.styleTags };
      } else {
        const audio = result.audio || result.audioHex;
        const url = api.getMediaUrl(audio) || api.getMediaUrl(result.audioUrl) || api.getMediaUrl(result.extraInfo?.audio_url);
        if (url) workData.result_url = url;
        else workData.result_data = audio;
      }

      await backendApi.saveWork(workData);
    } catch (error) {
      console.error('Failed to save work:', error.message);
    }
  }

  renderResult(result, params, verifiedAudio) {
    this.resultEmpty.style.display = 'none';
    this.resultContent.style.display = 'block';
    this.revokeBlobUrls();

    switch (this.currentModel) {
      case 'image':
        this.renderImageResult(result, params);
        break;
      case 'speech':
      case 'music':
        this.renderAudioResult(result, params,this.currentModel,verifiedAudio);
        break;
      case 'lyrics':
        this.renderLyricsResult(result);
        break;
      case 'chat': {
        const text = document.createElement('pre');
        text.textContent = result.content;
        this.resultContent.replaceChildren(text);
        break;
      }
      case 'video': {
        const url = api.getMediaUrl(result.videoUrl);
        if (!url) throw new Error('响应中缺少有效视频数据');
        const video = document.createElement('video');
        video.controls = true;
        video.src = url;
        video.style.maxWidth = '100%';
        const link = document.createElement('a');
        link.href = url;
        link.download = 'minimax-studio-preview.mp4';
        link.textContent = '下载视频';
        this.resultContent.replaceChildren(video,link);
        break;
      }
    }
  }

  renderImageResult(result, params) {
    const images = [];
    for (const value of Array.isArray(result.images) ? result.images : []) {
      if (typeof value === 'string' && params.response_format === 'base64') {
        const mimeType = value.startsWith('iVBORw0KGgo') ? 'image/png'
          : value.startsWith('/9j/') ? 'image/jpeg' : '';
        if (mimeType && !/[^a-zA-Z0-9+/=]/.test(value)) {
          images.push(`data:${mimeType};base64,${value}`);
          continue;
        }
      }
      const url = api.getMediaUrl(value);
      if (url) images.push(url);
    }
    if (!images.length) throw new Error('响应中缺少有效图片数据');
    this.resultContent.innerHTML = Templates.imageResult(images, result.metadata);

    this.resultContent.querySelectorAll('[data-lightbox-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.lightboxIndex);
        this.openLightbox(images[idx]);
      });
    });
  }

  renderAudioResult(result, params, modelType = this.currentModel, verifiedAudio) {
    const info = result.extraInfo || {};
    const rawAudio = result.audio || result.audioHex;
    const mimeType = verifiedAudio ? 'audio/wav' : api.getMimeType(info.audio_format || params.audio_format || params.format);
    const audioFormat = mimeType === 'audio/mpeg' ? 'mp3' : mimeType.slice('audio/'.length);
    if (this.localStudio && !verifiedAudio) throw new Error('本地音频未通过校验');
    const remoteUrl = !verifiedAudio && (api.getMediaUrl(rawAudio) || api.getMediaUrl(result.audioUrl) || api.getMediaUrl(info.audio_url));
    const audioSrc = remoteUrl || this.createBlobUrl(verifiedAudio || api.hexToBlob(rawAudio, mimeType));
    this.resultContent.innerHTML = Templates.audioResult(audioFormat, modelType, info, Boolean(remoteUrl && !this.localStudio));
    this.resultContent.querySelector('.audio-download').href = audioSrc;
    const player = this.resultContent.querySelector('.audio-player');
    const playbackStatus = this.resultContent.querySelector('.audio-playback-status');
    player.addEventListener('error', () => {
      playbackStatus.textContent = '浏览器无法播放这段音频';
    }, { once: true });
    player.src = audioSrc;
  }

  renderLyricsResult(result) {
    if (typeof result.lyrics !== 'string' || !result.lyrics.trim()) {
      throw new Error('响应中缺少有效歌词数据');
    }
    this.resultContent.innerHTML = Templates.lyricsResult(result);
    this._lastLyricsResult = result;

    const sendBtn = document.getElementById('send-lyrics-to-music-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => this.sendLyricsToMusic());
    const copyBtn = document.getElementById('copy-lyrics-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => this.copyLyrics());
  }

  renderQuotaError(error) {
    this.resultEmpty.style.display = 'none';
    this.resultContent.style.display = 'block';
    this.resultContent.innerHTML = Templates.quotaErrorResult(error);
  }

  sendLyricsToMusic() {
    if (!this._lastLyricsResult || !this.switchModel('music')) return;
    setTimeout(() => {
      const lyricsTextarea = this.configPanel.querySelector('[data-key="lyrics"]');
      const promptInput = this.configPanel.querySelector('[data-key="prompt"]');
      if (lyricsTextarea) {
        lyricsTextarea.value = this._lastLyricsResult.lyrics;
        lyricsTextarea.dispatchEvent(new Event('input'));
      }
      if (promptInput && this._lastLyricsResult.styleTags) {
        promptInput.value = this._lastLyricsResult.styleTags;
      }
    }, 100);
    Utils.showToast('歌词已填入音乐生成面板', 'success');
  }

  copyLyrics() {
    const lyricsEl = document.getElementById('lyrics-output');
    if (lyricsEl) {
      Utils.copyToClipboard(lyricsEl.textContent);
    }
  }

  renderError(message) {
    this.resultEmpty.style.display = 'none';
    this.resultContent.style.display = 'block';
    this.resultContent.innerHTML = Templates.errorResult(message);
  }

  openLightbox(src) {
    this.lightboxImage.src = src;
    this.lightbox.classList.add('open');
  }

  closeLightbox() {
    this.lightbox.classList.remove('open');
    this.lightboxImage.src = '';
  }

  _initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this._updateThemeUI(savedTheme);
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    this._updateThemeUI(newTheme);
  }

  _updateThemeUI(theme) {
    const icon = document.querySelector('#theme-toggle-btn .theme-icon');
    const label = document.getElementById('theme-label');
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    if (label) label.textContent = theme === 'dark' ? '暗色模式' : '亮色模式';
  }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
});
