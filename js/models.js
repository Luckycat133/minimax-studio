const MODEL_CONFIGS = {
  image: {
    id: 'image',
    name: '图片生成',
    icon: '🎨',
    description: '使用 Image-01 模型生成图片',
    quota: '50 张/日',
    apiPath: '/v1/image_generation',
    method: 'POST',
    models: [
      { value: 'image-01', label: 'image-01（标准）' },
      { value: 'image-01-live', label: 'image-01-live（画风）' }
    ],
    modes: [
      { value: 't2i', label: '文生图' },
      { value: 'i2i', label: '图生图' }
    ],
    params: {
      prompt: {
        type: 'textarea',
        label: '图片描述',
        placeholder: '描述你想生成的图片内容，最长 1500 字符',
        required: true,
        maxLength: 1500
      },
      model: {
        type: 'select',
        label: '模型',
        required: true,
        default: 'image-01',
        options: [
          { value: 'image-01', label: 'image-01（标准）' },
          { value: 'image-01-live', label: 'image-01-live（画风）' }
        ]
      },
      mode: {
        type: 'select',
        label: '生成模式',
        default: 't2i',
        options: [
          { value: 't2i', label: '文生图' },
          { value: 'i2i', label: '图生图' }
        ]
      },
      subject_reference_image: {
        type: 'file',
        label: '参考图片（图生图）',
        accept: 'image/jpeg,image/png,image/jpg',
        condition: { field: 'mode', value: 'i2i' },
        maxSize: 10 * 1024 * 1024
      },
      aspect_ratio: {
        type: 'select',
        label: '宽高比',
        default: '1:1',
        options: [
          { value: '1:1', label: '1:1 (1024×1024)' },
          { value: '16:9', label: '16:9 (1280×720)' },
          { value: '4:3', label: '4:3 (1152×864)' },
          { value: '3:2', label: '3:2 (1248×832)' },
          { value: '2:3', label: '2:3 (832×1248)' },
          { value: '3:4', label: '3:4 (864×1152)' },
          { value: '9:16', label: '9:16 (720×1280)' },
          { value: '21:9', label: '21:9 (1344×576)' }
        ]
      },
      n: {
        type: 'number',
        label: '生成数量',
        default: 1,
        min: 1,
        max: 9
      },
      response_format: {
        type: 'select',
        label: '返回格式',
        default: 'url',
        options: [
          { value: 'url', label: 'URL' },
          { value: 'base64', label: 'Base64' }
        ]
      },
      prompt_optimizer: {
        type: 'checkbox',
        label: '开启 Prompt 自动优化',
        default: false
      },
      style_type: {
        type: 'select',
        label: '画风风格（仅 image-01-live）',
        default: '',
        condition: { field: 'model', value: 'image-01-live' },
        options: [
          { value: '', label: '不设置' },
          { value: 'anime', label: '动漫 anime' },
          { value: 'photorealistic', label: '写实 photorealistic' },
          { value: '3d', label: '3D 3d' },
          { value: 'illustration', label: '插画 illustration' },
          { value: 'watercolor', label: '水彩 watercolor' }
        ]
      },
      style_weight: {
        type: 'range',
        label: '画风权重（仅 image-01-live）',
        default: 0.8,
        min: 0.01,
        max: 1,
        step: 0.01,
        condition: { field: 'model', value: 'image-01-live' }
      },
      seed: {
        type: 'number',
        label: '随机种子（可选）',
        min: 0,
        optional: true
      }
    },
    buildRequest: function (params) {
      const body = {
        model: params.model || 'image-01',
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '1:1',
        n: params.n || 1,
        response_format: params.response_format || 'url',
        prompt_optimizer: params.prompt_optimizer || false
      };
      if (params.seed) body.seed = params.seed;
      if (params.model === 'image-01-live' && params.style_type) {
        body.style = {
          style_type: params.style_type,
          style_weight: params.style_weight || 0.8
        };
      }
      if (params.mode === 'i2i' && params.subject_reference_image) {
        body.subject_reference = [
          {
            type: 'character',
            image_file: params.subject_reference_image
          }
        ];
      }
      return body;
    },
    parseResponse: function (data) {
      if (data.base_resp && data.base_resp.status_code !== 0) {
        return { success: false, error: data.base_resp.status_msg || '请求失败' };
      }
      const images = data.data?.image_urls || data.data?.image_base64 || [];
      return {
        success: true,
        type: 'image',
        images: images,
        metadata: data.metadata || {},
        taskId: data.id
      };
    }
  },

  speech: {
    id: 'speech',
    name: '语音合成',
    icon: '🎙️',
    description: '使用 Speech 2.8 模型合成语音',
    quota: '4,000 字符/日',
    apiPath: '/v1/t2a_v2',
    method: 'POST',
    models: [
      { value: 'speech-2.8-hd', label: 'speech-2.8-hd（高清）' },
      { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo（快速）' },
      { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
      { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' }
    ],
    params: {
      text: {
        type: 'textarea',
        label: '合成文本',
        placeholder: '输入需要合成语音的文本，最长 10000 字符。支持停顿标记 <#1.5#> 和语气词标签 (laughs)',
        required: true,
        maxLength: 10000
      },
      model: {
        type: 'select',
        label: '模型',
        required: true,
        default: 'speech-2.8-hd',
        options: [
          { value: 'speech-2.8-hd', label: 'speech-2.8-hd（高清）' },
          { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo（快速）' },
          { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
          { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' }
        ]
      },
      voice_id: {
        type: 'select',
        label: '音色',
        required: true,
        default: 'female-shaonv',
        options: [
          { value: 'male-qn-qingse', label: '青涩青年' },
          { value: 'male-qn-jingying', label: '精英青年' },
          { value: 'male-qn-badao', label: '霸道青年' },
          { value: 'male-qn-daxuesheng', label: '青年大学生' },
          { value: 'female-shaonv', label: '少女' },
          { value: 'female-yujie', label: '御姐' },
          { value: 'female-chengshu', label: '成熟女性' },
          { value: 'female-tianmei', label: '甜美女性' },
          { value: 'clever_boy', label: '聪明男童' },
          { value: 'cute_boy', label: '可爱男童' },
          { value: 'lovely_girl', label: '萌萌女童' },
          { value: 'Chinese (Mandarin)_News_Anchor', label: '新闻女声' },
          { value: 'Chinese (Mandarin)_Gentleman', label: '温润男声' },
          { value: 'Chinese (Mandarin)_Warm_Bestie', label: '温暖闺蜜' },
          { value: 'Chinese (Mandarin)_Sweet_Lady', label: '甜美女声' },
          { value: 'Chinese (Mandarin)_Lyrical_Voice', label: '抒情男声' },
          { value: 'English_Graceful_Lady', label: 'Graceful Lady (英文)' },
          { value: 'English_Persuasive_Man', label: 'Persuasive Man (英文)' },
          { value: 'English_Lucky_Robot', label: 'Lucky Robot (英文)' },
          { value: 'Japanese_Whisper_Belle', label: 'Whisper Belle (日文)' }
        ]
      },
      speed: {
        type: 'range',
        label: '语速',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1
      },
      vol: {
        type: 'range',
        label: '音量',
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1
      },
      pitch: {
        type: 'range',
        label: '语调',
        default: 0,
        min: -12,
        max: 12,
        step: 1
      },
      emotion: {
        type: 'select',
        label: '情绪',
        default: '',
        options: [
          { value: '', label: '自动' },
          { value: 'happy', label: '高兴' },
          { value: 'sad', label: '悲伤' },
          { value: 'angry', label: '愤怒' },
          { value: 'fearful', label: '害怕' },
          { value: 'disgusted', label: '厌恶' },
          { value: 'surprised', label: '惊讶' },
          { value: 'calm', label: '中性' },
          { value: 'fluent', label: '生动' },
          { value: 'whisper', label: '低语' }
        ]
      },
      audio_format: {
        type: 'select',
        label: '音频格式',
        default: 'mp3',
        options: [
          { value: 'mp3', label: 'MP3' },
          { value: 'wav', label: 'WAV' },
          { value: 'flac', label: 'FLAC' },
          { value: 'pcm', label: 'PCM' }
        ]
      },
      sample_rate: {
        type: 'select',
        label: '采样率',
        default: '32000',
        options: [
          { value: '8000', label: '8000 Hz' },
          { value: '16000', label: '16000 Hz' },
          { value: '22050', label: '22050 Hz' },
          { value: '24000', label: '24000 Hz' },
          { value: '32000', label: '32000 Hz' },
          { value: '44100', label: '44100 Hz' }
        ]
      },
      bitrate: {
        type: 'select',
        label: '比特率',
        default: '128000',
        options: [
          { value: '32000', label: '32 kbps' },
          { value: '64000', label: '64 kbps' },
          { value: '128000', label: '128 kbps' },
          { value: '256000', label: '256 kbps' }
        ]
      },
      language_boost: {
        type: 'select',
        label: '语言增强',
        default: '',
        options: [
          { value: '', label: '不设置' },
          { value: 'anime', label: '动漫 anime' },
          { value: 'auto', label: '自动' },
          { value: 'Chinese', label: '中文' },
          { value: 'English', label: '英文' },
          { value: 'Japanese', label: '日文' },
          { value: 'Korean', label: '韩文' }
        ]
      },
      output_format: {
        type: 'select',
        label: '输出格式',
        default: 'url',
        options: [
          { value: 'url', label: 'URL' },
          { value: 'hex', label: 'Hex' }
        ]
      }
    },
    buildRequest: function (params) {
      const body = {
        model: params.model || 'speech-2.8-hd',
        text: params.text,
        stream: false,
        voice_setting: {
          voice_id: params.voice_id || 'female-shaonv',
          speed: parseFloat(params.speed) || 1,
          vol: parseFloat(params.vol) || 1,
          pitch: parseInt(params.pitch) || 0
        },
        audio_setting: {
          sample_rate: parseInt(params.sample_rate) || 32000,
          bitrate: parseInt(params.bitrate) || 128000,
          format: params.audio_format || 'mp3',
          channel: 1
        },
        output_format: params.output_format || 'url'
      };
      if (params.emotion) body.voice_setting.emotion = params.emotion;
      if (params.language_boost) body.language_boost = params.language_boost;
      return body;
    },
    parseResponse: function (data) {
      if (data.base_resp && data.base_resp.status_code !== 0) {
        return { success: false, error: data.base_resp.status_msg || '请求失败' };
      }
      const result = {
        success: true,
        type: 'audio',
        audioHex: data.data?.audio || null,
        status: data.data?.status,
        extraInfo: data.extra_info || {},
        traceId: data.trace_id
      };
      if (data.data?.subtitle_file) {
        result.subtitleUrl = data.data.subtitle_file;
      }
      return result;
    }
  },

  music: {
    id: 'music',
    name: '音乐生成',
    icon: '🎵',
    description: '使用 Music 2.6 模型生成音乐',
    quota: '100 首/天（限免）',
    apiPath: '/v1/music_generation',
    method: 'POST',
    models: [
      { value: 'music-2.6', label: '🎵 music-2.6（推荐）' }
    ],
    params: {
      prompt: {
        type: 'textarea',
        label: '音乐描述',
        placeholder: '描述音乐的风格、情绪和场景，如"流行音乐, 难过, 适合在下雨的晚上"',
        required: true,
        maxLength: 2000
      },
      model: {
        type: 'select',
        label: '模型',
        required: true,
        default: 'music-2.6',
        options: [
          { value: 'music-2.6', label: '🎵 music-2.6（推荐）' }
        ]
      },
      lyrics: {
        type: 'textarea',
        label: '歌词',
        placeholder: '输入歌词内容，使用 \\n 分隔每行。支持结构标签：[Intro], [Verse], [Chorus], [Bridge], [Outro] 等',
        maxLength: 3500,
        optional: true
      },
      is_instrumental: {
        type: 'checkbox',
        label: '纯音乐（无人声）',
        default: false
      },
      lyrics_optimizer: {
        type: 'checkbox',
        label: '自动生成歌词（歌词为空时根据描述自动生成）',
        default: false
      },
      audio_format: {
        type: 'select',
        label: '音频格式',
        default: 'mp3',
        options: [
          { value: 'mp3', label: 'MP3' },
          { value: 'wav', label: 'WAV' },
          { value: 'pcm', label: 'PCM' }
        ]
      },
      sample_rate: {
        type: 'select',
        label: '采样率',
        default: '44100',
        options: [
          { value: '16000', label: '16000 Hz' },
          { value: '24000', label: '24000 Hz' },
          { value: '32000', label: '32000 Hz' },
          { value: '44100', label: '44100 Hz' }
        ]
      },
      bitrate: {
        type: 'select',
        label: '比特率',
        default: '256000',
        options: [
          { value: '32000', label: '32 kbps' },
          { value: '64000', label: '64 kbps' },
          { value: '128000', label: '128 kbps' },
          { value: '256000', label: '256 kbps' }
        ]
      },
      output_format: {
        type: 'select',
        label: '输出格式',
        default: 'url',
        options: [
          { value: 'url', label: 'URL' },
          { value: 'hex', label: 'Hex' }
        ]
      }
    },
    buildRequest: function (params) {
      const body = {
        model: params.model || 'music-2.6',
        prompt: params.prompt,
        is_instrumental: params.is_instrumental || false,
        lyrics_optimizer: params.lyrics_optimizer || false,
        stream: false,
        output_format: params.output_format || 'url',
        audio_setting: {
          sample_rate: parseInt(params.sample_rate) || 44100,
          bitrate: parseInt(params.bitrate) || 256000,
          format: params.audio_format || 'mp3'
        }
      };
      if (params.lyrics && !params.is_instrumental) {
        body.lyrics = params.lyrics;
      }
      return body;
    },
    parseResponse: function (data) {
      if (data.base_resp && data.base_resp.status_code !== 0) {
        return { success: false, error: data.base_resp.status_msg || '请求失败' };
      }
      return {
        success: true,
        type: 'audio',
        audioHex: data.data?.audio || null,
        status: data.data?.status,
        extraInfo: data.extra_info || {},
        traceId: data.trace_id
      };
    }
  },

  chat: {
    id: 'chat',
    name: 'AI 对话',
    icon: '💬',
    description: '使用 MiniMax M2.7 模型进行智能对话',
    quota: '按量计费',
    apiPath: '/v1/text/chatcompletion_v2',
    method: 'POST',
    models: [
      { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7（推荐）' },
      { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01' },
      { value: 'abab6.5s-chat', label: 'abab6.5s-chat' }
    ],
    params: {
      messages: {
        type: 'textarea',
        label: '对话内容',
        placeholder: '输入你想说的话，支持多轮对话...',
        required: true,
        maxLength: 8000
      },
      model: {
        type: 'select',
        label: '模型',
        required: true,
        default: 'MiniMax-M2.7',
        options: [
          { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7（推荐）' },
          { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01' },
          { value: 'abab6.5s-chat', label: 'abab6.5s-chat' }
        ]
      },
      temperature: {
        type: 'range',
        label: '温度 (Temperature)',
        default: 0.7,
        min: 0,
        max: 1,
        step: 0.1
      },
      top_p: {
        type: 'range',
        label: 'Top P',
        default: 0.95,
        min: 0,
        max: 1,
        step: 0.05
      },
      max_tokens: {
        type: 'number',
        label: '最大输出长度',
        default: 4096,
        min: 1,
        max: 32768
      }
    },
    buildRequest: function (params) {
      const messages = [];
      if (params._chatHistory && params._chatHistory.length > 0) {
        messages.push(...params._chatHistory);
      }
      messages.push({ role: 'user', content: params.messages });
      const body = {
        model: params.model || 'MiniMax-M2.7',
        messages: messages,
        temperature: parseFloat(params.temperature) || 0.7,
        top_p: parseFloat(params.top_p) || 0.95,
        max_tokens: parseInt(params.max_tokens) || 4096
      };
      return body;
    },
    parseResponse: function (data) {
      if (data.base_resp && data.base_resp.status_code !== 0) {
        return { success: false, error: data.base_resp.status_msg || '请求失败' };
      }
      const choices = data.choices || [];
      const content = choices.length > 0 && choices[0].message ? choices[0].message.content : '';
      return {
        success: true,
        type: 'chat',
        content: content,
        model: data.model || '',
        usage: data.usage || {},
        choices: choices
      };
    }
  },

  lyrics: {
    id: 'lyrics',
    name: '歌词生成',
    icon: '✍️',
    description: '生成歌曲歌词，支持完整创作和编辑续写',
    quota: '辅助工具',
    apiPath: '/v1/lyrics_generation',
    method: 'POST',
    params: {
      mode: {
        type: 'select',
        label: '生成模式',
        required: true,
        default: 'write_full_song',
        options: [
          { value: 'write_full_song', label: '写完整歌曲' },
          { value: 'edit', label: '编辑/续写歌词' }
        ]
      },
      prompt: {
        type: 'textarea',
        label: '提示词',
        placeholder: '描述歌曲主题、风格或编辑方向，如"一首关于夏日海边的轻快情歌"',
        maxLength: 2000
      },
      lyrics: {
        type: 'textarea',
        label: '现有歌词（仅编辑模式）',
        placeholder: '输入现有歌词内容，用于续写或修改',
        maxLength: 3500,
        condition: { field: 'mode', value: 'edit' }
      },
      title: {
        type: 'text',
        label: '歌曲标题（可选）',
        placeholder: '传入后输出将保持该标题不变',
        optional: true
      }
    },
    buildRequest: function (params) {
      const body = {
        mode: params.mode || 'write_full_song'
      };
      if (params.prompt) body.prompt = params.prompt;
      if (params.mode === 'edit' && params.lyrics) body.lyrics = params.lyrics;
      if (params.title) body.title = params.title;
      return body;
    },
    parseResponse: function (data) {
      if (data.base_resp && data.base_resp.status_code !== 0) {
        return { success: false, error: data.base_resp.status_msg || '请求失败' };
      }
      return {
        success: true,
        type: 'lyrics',
        title: data.song_title || '',
        styleTags: data.style_tags || '',
        lyrics: data.lyrics || ''
      };
    }
  }
};

const ERROR_CODES = {
  0: '请求成功',
  1000: '未知错误',
  1001: '超时',
  1002: '触发限流，请稍后再试',
  1004: '账号鉴权失败，请检查 API Key',
  1008: '账号余额不足',
  1026: '内容涉及敏感信息',
  1039: '触发 TPM 限流',
  1042: '非法字符超过 10%',
  2013: '参数异常，请检查输入',
  2049: '无效的 API Key'
};
