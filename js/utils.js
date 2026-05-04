const Utils = {
  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  generateId() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  },

  debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
      <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        Utils.showToast('已复制到剪贴板', 'success');
      }).catch(() => {
        Utils._fallbackCopy(text);
      });
    } else {
      Utils._fallbackCopy(text);
    }
  },

  _fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      Utils.showToast('已复制到剪贴板', 'success');
    } catch (e) {
      Utils.showToast('复制失败', 'error');
    }
    document.body.removeChild(textarea);
  },

  getErrorMessage(error) {
    if (error.message) return error.message;
    if (typeof error === 'string') return error;
    return '未知错误';
  },

  createLoadingOverlay(text = '生成中...') {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    const overlayId = 'loading-' + this.generateId();
    overlay.id = overlayId;
    overlay.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <p class="loading-text">${text}</p>
        <p class="loading-subtext">这可能需要一些时间，请耐心等待</p>
        <p class="loading-timer" id="${overlayId}-timer">已等待 0 秒</p>
      </div>
    `;

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const timerEl = document.getElementById(`${overlayId}-timer`);
      if (timerEl) {
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        timerEl.textContent = minutes > 0
          ? `已等待 ${minutes} 分 ${seconds} 秒`
          : `已等待 ${seconds} 秒`;
      } else {
        clearInterval(timerInterval);
      }
    }, 1000);

    overlay._timerInterval = timerInterval;
    overlay._cleanup = () => clearInterval(timerInterval);

    return overlay;
  },

  sanitizeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
