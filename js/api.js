class MiniMaxAPI {
  constructor() {
    this.baseUrl = 'https://api.minimaxi.com';
    this.apiKey = '';
  }

  setApiKey(key) {
    this.apiKey = key;
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
        signal: controller.signal,
        redirect: 'error'
      });

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

      const data = await response.json().catch(error => {
        if (error.name !== 'SyntaxError') throw error;
        throw new Error('MiniMax 返回了无效的响应数据', { cause: error });
      });
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('MiniMax 返回了无效的响应数据');
      }
      return data;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('请求超时，生成结果未知', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
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

  hexToBlob(hex, mimeType = 'audio/mpeg') {
    if (typeof hex !== 'string' || !hex.length || hex.length % 2 || /[^0-9a-f]/i.test(hex)) {
      throw new Error('响应中缺少有效音频数据');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return new Blob([bytes], { type: mimeType });
  }

  getMimeType(format) {
    const normalized = typeof format === 'string' ? format.toLowerCase() : '';
    return ['wav', 'flac', 'pcm'].includes(normalized) ? `audio/${normalized}` : 'audio/mpeg';
  }

  getMediaUrl(value) {
    if (typeof value !== 'string' || !/^(?:https?:\/\/|\/(?![\\/]))/i.test(value)) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (url.username || url.password) return null;
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin)
        ? url.href
        : null;
    } catch {
      return null;
    }
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
