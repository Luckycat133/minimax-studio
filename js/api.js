class MiniMaxAPI {
  constructor() {
    this.baseUrl = 'https://api.minimaxi.com';
    this.apiKey = localStorage.getItem('minimax_api_key') || '';
  }

  setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('minimax_api_key', key);
  }

  getApiKey() {
    return this.apiKey;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  async request(path, body, options = {}) {
    if (!this.apiKey) {
      throw new Error('请先配置 API Key');
    }

    const controller = new AbortController();
    const timeout = options.timeout || 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.base_resp?.status_msg || errorMsg;
        } catch (e) {
          // ignore parse error
        }
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请稍后重试');
      }
      throw error;
    }
  }

  async generateImage(params) {
    const config = MODEL_CONFIGS.image;
    const body = config.buildRequest(params);
    const data = await this.request(config.apiPath, body);
    return config.parseResponse(data);
  }

  async synthesizeSpeech(params) {
    const config = MODEL_CONFIGS.speech;
    const body = config.buildRequest(params);
    const data = await this.request(config.apiPath, body);
    return config.parseResponse(data);
  }

  async generateMusic(params) {
    const config = MODEL_CONFIGS.music;
    const body = config.buildRequest(params);
    const data = await this.request(config.apiPath, body, { timeout: 180000 });
    return config.parseResponse(data);
  }

  async generateLyrics(params) {
    const config = MODEL_CONFIGS.lyrics;
    const body = config.buildRequest(params);
    const data = await this.request(config.apiPath, body);
    return config.parseResponse(data);
  }

  async generateChat(params) {
    const config = MODEL_CONFIGS.chat;
    const body = config.buildRequest(params);
    const data = await this.request(config.apiPath, body);
    return config.parseResponse(data);
  }

  hexToBlob(hex, mimeType = 'audio/mp3') {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return new Blob([bytes], { type: mimeType });
  }

  getMimeType(format) {
    const map = {
      'mp3': 'audio/mp3',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'pcm': 'audio/pcm'
    };
    return map[format] || 'audio/mp3';
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

const api = new MiniMaxAPI();
