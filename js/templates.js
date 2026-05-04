class Templates {
  static quotaDisplay(quota) {
    if (!quota) return '';
    const q = quota;
    const items = [
      { icon: '🎨', label: '图片', used: q.image.used, limit: q.image.limit },
      { icon: '🎙️', label: '语音', used: q.speech.used, limit: q.speech.limit },
      { icon: '🎵', label: '音乐', used: q.music.used, limit: q.music.limit }
    ];
    return items.map(item => `
      <div class="quota-item">
        <span class="quota-icon">${item.icon}</span>
        <span class="quota-label">${item.label}</span>
        <span class="quota-value">${item.used}/${item.limit}</span>
        <div class="quota-bar">
          <div class="quota-fill" style="width: ${Math.min((item.used / item.limit) * 100, 100)}%"></div>
        </div>
      </div>
    `).join('');
  }

  static imageResult(images, metadata) {
    const imageCount = images.length;
    let html = `<div class="result-header">`;
    html += `<span class="result-title">🖼️ 生成结果（${imageCount} 张）</span>`;
    html += `<div class="result-actions">`;
    if (metadata) {
      html += `<span class="result-action-btn">成功: ${metadata.success_count || imageCount}</span>`;
      if (metadata.failed_count > 0) {
        html += `<span class="result-action-btn" style="color:var(--error)">失败: ${metadata.failed_count}</span>`;
      }
    }
    html += `</div></div>`;
    html += `<div class="image-grid">`;
    images.forEach((url, i) => {
      html += `<div class="image-card">
        <img src="${Utils.sanitizeHtml(url)}" alt="Generated image ${i + 1}" loading="lazy">
        <div class="image-card-actions">
          <button class="result-action-btn" data-lightbox-index="${i}">🔍 查看</button>
          <a class="result-action-btn" href="${Utils.sanitizeHtml(url)}" download="minimax_image_${i + 1}.png" target="_blank" rel="noopener">💾 下载</a>
        </div>
      </div>`;
    });
    html += `</div>`;
    return html;
  }

  static audioResult(audioSrc, audioFormat, modelType, info) {
    let html = `<div class="result-header">`;
    html += `<span class="result-title">${modelType === 'speech' ? '🎙️' : '🎵'} 生成结果</span>`;
    html += `<div class="result-actions">`;
    if (audioSrc) {
      html += `<a class="result-action-btn" href="${audioSrc}" download="minimax_${modelType}.${Utils.sanitizeHtml(audioFormat)}" target="_blank" rel="noopener">💾 下载</a>`;
    }
    html += `</div></div>`;
    html += `<div class="audio-result">`;
    if (audioSrc) {
      html += `<audio class="audio-player" controls src="${audioSrc}"></audio>`;
    } else {
      html += `<p style="color:var(--text-muted);text-align:center;padding:20px;">音频生成中，请稍候...</p>`;
    }

    if (Object.keys(info).length > 0) {
      html += `<div class="audio-info">`;
      const infoFields = [
        { key: 'audio_length', label: '时长', format: v => Utils.formatTime(v) },
        { key: 'audio_sample_rate', label: '采样率', format: v => `${v} Hz` },
        { key: 'audio_size', label: '文件大小', format: v => Utils.formatFileSize(v) },
        { key: 'bitrate', label: '比特率', format: v => `${Math.round(v / 1000)} kbps` },
        { key: 'audio_format', label: '格式', format: v => v.toUpperCase() },
        { key: 'usage_characters', label: '计费字符', format: v => v },
        { key: 'music_duration', label: '音乐时长', format: v => Utils.formatTime(v) }
      ];
      infoFields.forEach(({ key, label, format }) => {
        if (info[key] != null) {
          html += `<div class="audio-info-item"><span class="audio-info-label">${label}</span><span class="audio-info-value">${format(info[key])}</span></div>`;
        }
      });
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  static chatResult(result, chatHistory) {
    let html = `<div class="result-header">`;
    html += `<span class="result-title">💬 对话结果</span>`;
    html += `<div class="result-actions">`;
    html += `<button class="result-action-btn" id="copy-chat-btn">📋 复制</button>`;
    html += `<button class="result-action-btn" id="clear-chat-btn">🗑️ 清空对话</button>`;
    html += `</div></div>`;
    html += `<div class="chat-result">`;
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.forEach(msg => {
        const isUser = msg.role === 'user';
        html += `<div class="chat-message ${isUser ? 'chat-user' : 'chat-assistant'}">`;
        html += `<div class="chat-avatar">${isUser ? '👤' : '🤖'}</div>`;
        html += `<div class="chat-bubble">${Utils.sanitizeHtml(msg.content).replace(/\n/g, '<br>')}</div>`;
        html += `</div>`;
      });
    }
    if (result && result.content) {
      html += `<div class="chat-message chat-assistant">`;
      html += `<div class="chat-avatar">🤖</div>`;
      html += `<div class="chat-bubble">${Utils.sanitizeHtml(result.content).replace(/\n/g, '<br>')}</div>`;
      html += `</div>`;
    }
    if (result && result.usage) {
      html += `<div class="chat-usage">`;
      html += `<span>模型: ${Utils.sanitizeHtml(result.model || 'M2.7')}</span>`;
      if (result.usage.total_tokens) html += `<span>Tokens: ${result.usage.total_tokens}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  static lyricsResult(result) {
    let html = `<div class="result-header">`;
    html += `<span class="result-title">✍️ 歌词生成结果</span>`;
    html += `<div class="result-actions">`;
    html += `<button class="result-action-btn" id="send-lyrics-to-music-btn">🎵 用此歌词生成音乐</button>`;
    html += `<button class="result-action-btn" id="copy-lyrics-btn">📋 复制歌词</button>`;
    html += `</div></div>`;
    html += `<div class="lyrics-result">`;
    if (result.title || result.styleTags) {
      html += `<div class="lyrics-meta">`;
      if (result.title) {
        html += `<span class="lyrics-tag">🎵 ${Utils.sanitizeHtml(result.title)}</span>`;
      }
      if (result.styleTags) {
        result.styleTags.split(',').forEach(tag => {
          html += `<span class="lyrics-tag">${Utils.sanitizeHtml(tag.trim())}</span>`;
        });
      }
      html += `</div>`;
    }
    html += `<div class="lyrics-content" id="lyrics-output">${Utils.sanitizeHtml(result.lyrics)}</div>`;
    html += `</div>`;
    return html;
  }

  static errorResult(message) {
    const hints = [
      { pattern: /鉴权|API Key|api key/i, hint: '请检查服务器 API Key 配置。' },
      { pattern: /限流|rate/i, hint: '已达到用量上限，请稍后重试或等待额度恢复。' },
      { pattern: /余额/, hint: '账户余额不足，请联系管理员。' },
      { pattern: /敏感/, hint: '输入内容涉及敏感信息，请修改后重试。' },
      { pattern: /参数/, hint: '请检查输入参数是否符合要求。' },
      { pattern: /Failed to fetch|NetworkError/, hint: '网络连接失败，请检查网络。' },
      { pattern: /未配置/, hint: '服务器未配置 MiniMax API Key，请联系管理员。' },
      { pattern: /超时|timeout/i, hint: '请求超时，AI 服务响应较慢，请重试。' },
      { pattern: /禁用|disabled/i, hint: '账户已被禁用，请联系管理员。' },
      { pattern: /锁定|locked/i, hint: '账户因多次失败尝试被锁定，请稍后再试。' }
    ];
    const match = hints.find(h => h.pattern.test(message));
    const hint = match ? match.hint : '';

    return `
      <div class="error-result">
        <div class="error-icon">❌</div>
        <div class="error-message">${Utils.sanitizeHtml(message)}</div>
        ${hint ? `<div class="error-hint">${hint}</div>` : ''}
      </div>
    `;
  }

  static quotaErrorResult(error) {
    const q = error.quota;
    return `
      <div class="error-result">
        <div class="error-icon">⚠️</div>
        <div class="error-message">${Utils.sanitizeHtml(error.message)}</div>
        <div class="quota-error-detail">
          <p>今日已使用：${q.used} / ${q.limit} ${q.unit}</p>
          <p>额度将在明日重置</p>
        </div>
      </div>
    `;
  }

  static worksList(works) {
    if (!works || works.length === 0) {
      return `
        <div class="works-empty">
          <span class="works-empty-icon">📁</span>
          <p>暂无作品</p>
        </div>
      `;
    }

    const typeIcons = { image: '🎨', speech: '🎙️', music: '🎵', lyrics: '✍️', chat: '💬' };
    const typeLabels = { image: '图片', speech: '语音', music: '音乐', lyrics: '歌词', chat: '对话' };

    return `
      <div class="works-filter">
        <select id="works-type-filter" onchange="app.filterWorks(this.value)">
          <option value="">全部类型</option>
          ${Object.entries(typeLabels).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <input type="text" id="works-search" placeholder="搜索作品..." oninput="app.searchWorks(this.value)">
      </div>
      <div class="works-list" id="works-list">
        ${works.map(work => `
          <div class="work-item" data-id="${work.id}" data-type="${work.work_type}">
            <div class="work-icon">${typeIcons[work.work_type] || '📄'}</div>
            <div class="work-info">
              <div class="work-title">${Utils.sanitizeHtml(work.title || (work.prompt ? work.prompt.substring(0, 50) : '未命名'))}</div>
              <div class="work-meta">
                <span>${typeLabels[work.work_type] || work.work_type}</span>
                <span>${new Date(work.created_at).toLocaleDateString('zh-CN')}</span>
                ${work.is_favorite ? '<span class="work-favorite-badge">⭐ 收藏</span>' : ''}
              </div>
            </div>
            <div class="work-actions">
              <button class="work-action-btn" onclick="app.toggleFavorite(${work.id}, ${!work.is_favorite})">${work.is_favorite ? '⭐' : '☆'}</button>
              <button class="work-action-btn" onclick="app.viewWork(${work.id})">查看</button>
              <button class="work-action-btn delete" onclick="app.deleteWork(${work.id})">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  static configPanel(params, advancedKeys) {
    const paramEntries = Object.entries(params);
    const basicParams = [];
    const advancedParams = [];

    paramEntries.forEach(([key, param]) => {
      if (advancedKeys.includes(key)) {
        advancedParams.push([key, param]);
      } else {
        basicParams.push([key, param]);
      }
    });

    let html = '<div class="config-section">';
    html += '<div class="config-section-title">基本参数</div>';
    html += Templates._renderParamGroup(basicParams);
    html += '</div>';

    if (advancedParams.length > 0) {
      html += '<div class="config-section">';
      html += '<div class="config-section-title">高级参数</div>';
      html += Templates._renderParamGroup(advancedParams);
      html += '</div>';
    }

    return html;
  }

  static _renderParamGroup(paramEntries) {
    let html = '';
    let inRow = false;

    paramEntries.forEach(([key, param], index) => {
      const isSmall = ['select', 'checkbox', 'range'].includes(param.type);
      const nextIsSmall = paramEntries[index + 1] && ['select', 'checkbox', 'range'].includes(paramEntries[index + 1][1].type);

      if (isSmall && nextIsSmall && !inRow) {
        html += '<div class="config-row">';
        inRow = true;
      }

      html += inRow ? `<div>${Templates._renderParam(key, param)}</div>` : `<div class="config-row full">${Templates._renderParam(key, param)}</div>`;

      if (inRow && (!nextIsSmall || index === paramEntries.length - 1)) {
        html += '</div>';
        inRow = false;
      }
    });

    return html;
  }

  static _renderParam(key, param) {
    const conditionAttr = param.condition ? `data-condition-field="${param.condition.field}" data-condition-value="${param.condition.value}"` : '';
    const hiddenClass = param.condition ? 'hidden' : '';
    let html = `<div class="param-group ${hiddenClass}" ${conditionAttr} data-param="${key}">`;

    html += `<label class="param-label">${param.label}`;
    if (param.required) html += `<span class="required">*</span>`;
    if (param.optional) html += `<span class="optional">（可选）</span>`;
    html += `</label>`;

    switch (param.type) {
      case 'text':
        html += `<input type="text" class="param-input" data-key="${key}" placeholder="${param.placeholder || ''}" value="${Utils.sanitizeHtml(String(param.default || ''))}">`;
        break;
      case 'textarea':
        const tallClass = param.maxLength > 1000 ? 'tall' : '';
        html += `<textarea class="param-textarea ${tallClass}" data-key="${key}" placeholder="${param.placeholder || ''}" maxlength="${param.maxLength || ''}">${Utils.sanitizeHtml(String(param.default || ''))}</textarea>`;
        if (param.maxLength) {
          html += `<div class="char-count" data-count-for="${key}">0 / ${param.maxLength}</div>`;
        }
        break;
      case 'select':
        html += `<select class="param-select" data-key="${key}">`;
        (param.options || []).forEach(opt => {
          const selected = opt.value === (param.default || '') ? 'selected' : '';
          html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
        });
        html += `</select>`;
        break;
      case 'number':
        html += `<input type="number" class="param-input" data-key="${key}" value="${param.default || ''}" min="${param.min || ''}" max="${param.max || ''}" step="${param.step || 1}">`;
        break;
      case 'range':
        html += `<div class="param-range-group">`;
        html += `<input type="range" class="param-range" data-key="${key}" value="${param.default || 0}" min="${param.min || 0}" max="${param.max || 100}" step="${param.step || 1}">`;
        html += `<span class="param-range-value" data-range-display="${key}">${param.default || 0}</span>`;
        html += `</div>`;
        break;
      case 'checkbox':
        html += `<label class="param-checkbox">`;
        html += `<input type="checkbox" data-key="${key}" ${param.default ? 'checked' : ''}>`;
        html += `<span class="checkbox-custom"></span>`;
        html += `<span class="checkbox-label">${param.description || param.label}</span>`;
        html += `</label>`;
        break;
      case 'file':
        html += `<div class="file-upload">`;
        html += `<input type="file" class="file-upload-input" data-key="${key}" accept="${param.accept || '*'}">`;
        html += `<div class="file-upload-area" data-upload-area="${key}">`;
        html += `<span class="file-upload-icon">📁</span>`;
        html += `<span class="file-upload-text">点击或拖拽上传图片</span>`;
        html += `</div>`;
        html += `</div>`;
        break;
    }

    html += '</div>';
    return html;
  }

  static generationProgress(modelType) {
    const messages = {
      image: '正在生成图片...',
      speech: '正在合成语音...',
      music: '正在生成音乐（可能需要较长时间）...',
      lyrics: '正在生成歌词...',
      chat: '正在思考回复...'
    };
    return messages[modelType] || '生成中...';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Templates;
}
