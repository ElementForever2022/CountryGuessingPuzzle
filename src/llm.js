'use strict';

/**
 * 大模型客户端。
 * 统一走 OpenAI 兼容的 /chat/completions 接口，零依赖（Node >= 18 原生 fetch）。
 *
 * 已内置的 Provider（可在 README 中查看如何申请）：
 *   免费：ollama（本地）、zhipu（GLM-4-Flash 免费）、siliconflow（硅基流动有免费模型）
 *   付费：deepseek、openai、moonshot
 *   自定义：custom（任意 OpenAI 兼容地址）
 */

const PROVIDERS = {
  ollama: {
    base: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    needKey: false,
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5:32b', 'llama3.1:8b', 'deepseek-r1:7b'],
  },
  zhipu: {
    base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    needKey: true,
    models: [
      'glm-4.7-flash',
      'glm-4.7',
      'glm-4.5-flash',
      'glm-4.5-air',
      'glm-4.1v-thinking-flash',
      'glm-4-plus',
    ],
  },
  siliconflow: {
    base: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    needKey: true,
    models: [
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'THUDM/GLM-4-9B-0414',
    ],
  },
  deepseek: {
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    needKey: true,
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  openai: {
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needKey: true,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  moonshot: {
    base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    needKey: true,
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
  },
  custom: { base: '', model: '', needKey: true, models: [] },
};

/** 返回每个 Provider 的描述与预设模型列表（供 GUI 表单渲染，不含密钥等敏感信息） */
function getProviderCatalog() {
  const out = {};
  for (const key of Object.keys(PROVIDERS)) {
    const p = PROVIDERS[key];
    out[key] = {
      name: key,
      base: p.base,
      model: p.model,
      needKey: p.needKey,
      models: p.models || [],
    };
  }
  return out;
}

/** 合并用户配置与 Provider 预设，得到可直接调用的 LLM 连接信息 */
function resolveLlmConfig(cfg) {
  const preset = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  return {
    provider: cfg.provider,
    base: (cfg.apiBase || preset.base).replace(/\/+$/, ''),
    apiKey: cfg.apiKey || '',
    model: cfg.model || preset.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeoutMs: cfg.timeoutMs,
  };
}

/** 是否具备调用大模型的条件 */
function isLlmConfigured(cfg) {
  const c = resolveLlmConfig(cfg);
  if (!c.base) return false;
  if (PROVIDERS[cfg.provider] && !PROVIDERS[cfg.provider].needKey) return true;
  return !!c.apiKey;
}

/** 移除模型输出中的推理块（如 <think>...</think>），防止泄露题目与干扰解析 */
function stripThinking(text) {
  let s = String(text || '');
  const patterns = [
    /<(?:think|thinking|reasoning|analysis|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|analysis|thought)>/gi,
    /\[(?:think|thinking|reasoning|分析|思考)\][\s\S]*?\[\/(?:think|thinking|reasoning|分析|思考)\]/gi,
  ];
  for (const re of patterns) s = s.replace(re, '');
  return s.trim();
}

/** 归一化模型回复：剥离思考块、提取 <answer>/<output> 等结构标签内的内容、清除残留标签 */
function normalizeReply(text) {
  // 猜中标记 <WIN> 可能在任意位置（含思考块内），先于剥离检测
  const hasWin = /<WIN>/i.test(text || '');
  let s = stripThinking(text);
  const tag = s.match(/<(?:answer|final_answer|final|output|result|response)>([\s\S]*?)<\/(?:answer|final_answer|final|output|result|response)>/i);
  if (tag && tag[1] && tag[1].trim()) s = tag[1];
  s = s.replace(/<[^>]+>/g, '').trim();
  if (hasWin) s += '<WIN>';
  return s;
}

/** 调用 OpenAI 兼容的 chat/completions，返回模型文本 */
async function chat(cfg, messages, opts = {}) {
  const c = resolveLlmConfig(cfg);
  if (!c.base) throw new Error('未配置 apiBase（接口地址）');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs || 60000);

  try {
    const res = await fetch(`${c.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: c.model,
        messages,
        temperature: opts.temperature ?? c.temperature ?? 0,
        max_tokens: opts.maxTokens ?? c.maxTokens ?? 512,
        // 生成类任务可传 opts.thinking='disabled' 关闭深度思考，避免 token 被推理挤占导致正文截断
        ...(opts.thinking ? { thinking: { type: opts.thinking } } : {}),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}：${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message ?? {};
    const content = String(message.content ?? '');

    // raw 模式：同时返回正文与思考内容（reasoning_content），由调用方决定如何处理
    if (opts.raw) {
      return {
        content: content.trim(),
        reasoning: String(message.reasoning_content ?? '').trim(),
      };
    }

    // 默认路径：归一化正文；为空时从思考内容里兜底提取，兼容思考模型
    // 注意：此处只做“剥壳”，绝不能用 extractFinalAnswer 猜答案——否则
    // 一般文本生成（如趣味介绍）会被误判成“是/不是”。
    const cleaned = normalizeReply(content);
    if (cleaned) return cleaned.trim();
    const combined = `${content}\n${message.reasoning_content ?? ''}`;
    const reasoningClean = stripThinking(combined);
    if (reasoningClean) return reasoningClean.trim();
    throw new Error('模型返回内容为空');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 裁判系统提示词 */
function buildJudgeSystem(target) {
  return [
    '你是一款文字猜谜游戏“海龟汤”的裁判。',
    '游戏背景：主持人心中有一个秘密目标“国家”，玩家看不到它，只能不断向你提出“是/不是”的问题来缩小范围并最终猜出目标。',
    '你必须依据目标国家的真实情况如实回答，绝不能直接说出目标国家的名称。',
    '',
    '回答规则（严格遵守）：',
    '1. 如果玩家的问题是可用“是/不是”判断真假的陈述（例如“这个国家在亚洲吗？”），',
    '   请依据目标国家的真实情况回答“是”或“不是”。',
    '   模糊但可判定的事实也要如实回答（例如“这个国家同时横跨南北半球吗？”若属实就回答“是”）。',
    '2. 如果问题不是合格的“是/不是”判断题，例如：一次问了多个问题、问题含糊不清、',
    '   与地理无关、是开放性问题、命令式语句、或无法依据目标国家事实判断，',
    '   请回答“无效：”并附一句简短原因（如“无效：请一次只问一个问题”）。',
    '3. 如果玩家在猜测国家名称（例如“答案是法国吗？”“这个国家是中国吧？”）：',
    '   若猜中的正是目标国家，只回答“是<WIN>”；若猜错，只回答“不是”。',
    '4. 最终回答必须放在 <answer> 与 </answer> 标签之间，标签内只允许“是”“不是”“无效：原因”“是<WIN>”。',
    '   例如：<answer>是</answer> 或 <answer>无效：请一次只问一个问题</answer>。',
    '5. 除 <answer> 标签外不要输出任何其他内容，尤其不能泄露目标国家名称。',
    '',
    `秘密目标国家：${target.name}（${target.en}）`,
  ].join('\n');
}

/** 判断文本是否已经是简洁的裁判答案（而非冗长的推理文字） */
function looksLikeAnswer(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/<WIN>/.test(t)) return true;
  return /^(是|不是|无效)/.test(t) && t.length <= 40;
}

/** 从推理文本中尽力提取最终答案（作为正文过长/为空时的兜底，不保证绝对准确） */
function extractFinalAnswer(text) {
  const r = String(text || '');
  // 1) 明确的句式
  const m = r.match(/(?:最终答案|答案是|答案为|答案应为|应该回答|应当回答|所以回答|因此回答|结论是|判定为)\s*[:：]?\s*(是|不是|无效)/);
  if (m) return m[1];
  // 2) 末尾独立成行的答案（排除截断的推理残句）
  const lines = r.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) {
    const mm = lines[lines.length - 1].match(/^(是|不是|无效)[。.！!]?$/);
    if (mm) return mm[1];
  }
  // 3) 兜底：最后一个独立答案词（排除“是否”这类误匹配）
  const tokens = [];
  const re = /(不是|是(?!否)|无效)/g;
  let token;
  while ((token = re.exec(r)) !== null) tokens.push(token[0]);
  if (tokens.length) return tokens[tokens.length - 1] === '无效' ? '无效' : tokens[tokens.length - 1];
  return '';
}

/** 让大模型裁判判断一个问题，返回 { type, reason? } */
async function judgeWithLlm(cfg, target, question) {
  const messages = [
    { role: 'system', content: buildJudgeSystem(target) },
    { role: 'user', content: `玩家的问题：${question}` },
  ];
  let reply;
  try {
    // 用 raw 模式拿到 reasoning_content，正文剥离 think 块与结构标签；
    // maxTokens 放宽，避免推理模型把 token 全花在思考上导致最终答案被截断
    const raw = await chat(cfg, messages, { temperature: 0, maxTokens: 1024, raw: true });
    reply = normalizeReply(raw.content);
    // 若归一化后仍是冗长的推理文字（不是简洁答案），退而从完整原文提取最终答案
    if (!looksLikeAnswer(reply)) {
      reply = extractFinalAnswer(`${raw.content}\n${raw.reasoning}`);
    }
  } catch (e) {
    return { type: 'error', message: e.message };
  }
  return parseJudgeReply(reply);
}

/** 解析裁判返回文本为结构化结果（先归一化，防止解析失败与泄题） */
function parseJudgeReply(reply) {
  const t = normalizeReply(reply || '');
  if (/<WIN>/.test(t) || /答对|猜对|猜中了/.test(t)) return { type: 'win' };
  if (/^不是/.test(t)) return { type: 'no' };
  if (/^是/.test(t)) return { type: 'yes' };
  if (/^无效/.test(t)) return { type: 'invalid', reason: t.replace(/^无效[:：]?\s*/, '') || '问题无效' };
  if (/^(不知道|无法判断|不确定)/.test(t)) return { type: 'invalid', reason: t };
  // 注意：不在此处回显原始回复，避免把模型的推理/国名泄露给玩家
  return { type: 'invalid', reason: '裁判回答无法解析，请换一种问法后重试' };
}

/** 让大模型生成国家趣味介绍（用于揭晓环节；仅在国家无内置 intro 时兜底） */
async function introduceCountry(cfg, target) {
  const userPrompt = [
    `请用中文介绍“${target.name}”这个国家，帮助玩家了解它的地理与人文特征。`,
    '要求：',
    '- 输出 3~6 条要点，每条以“- ”开头并独占一行。',
    '- 内容尽量覆盖：地理位置、首都、官方语言、人口、面积、国旗特征、著名地标、历史文化或经济上的有趣事实。',
    '- 语气轻松有趣，适合地理科普；不要输出标题或客套话。',
  ].join('\n');

  return introduceByPrompt(cfg, userPrompt, target, '');
}

/** 通用介绍生成：传入一个（可为函数的）用户提示词，返回模型文本 */
async function introduceByPrompt(cfg, promptOrFn, target, wikiExtract) {
  const content = typeof promptOrFn === 'function' ? promptOrFn(target) : promptOrFn;
  // 生成类任务的系统提示：要求直接输出正式内容，避免思考模型把推理/分析写进正文
  let system = '直接输出最终正式内容，不要包含任何思考过程、分析步骤、草稿或多余的说明文字。';

  // 有维基导言时：以它为权威事实来源，禁止编造资料中不存在的具体事实（如国旗颜色、人口等）
  let userContent = content;
  if (wikiExtract && wikiExtract.trim()) {
    system += ' 你的创作必须严格以用户提供的[维基百科资料]为依据：只准使用资料中出现的事实，资料中没有提到的任何具体事实（尤其国旗颜色、人口、面积、首都、官方语言等）一律不得自行编造或凭记忆补充；宁可少写，不可写错。';
    userContent = `[维基百科资料]\n${wikiExtract.trim()}\n\n${content}`;
  }

  // 生成类请求：放大 maxTokens，避免思考模型的 token 被推理挤占导致正文为空或被截断成残缺片段；
  // 智谱 GLM 深度思考模型默认开启思考，这里显式关闭
  const makeOpts = () => ({
    temperature: 0.7,
    maxTokens: 2048,
    raw: true,
    ...(cfg.provider === 'zhipu' ? { thinking: 'disabled' } : {}),
  });

  // 429 限流/超时做少量重试，避免揭晓时因限流拿不到介绍
  async function askWithRetry(messages, tries = 2) {
    let lastErr;
    for (let i = 0; i <= tries; i++) {
      try {
        return await chat(cfg, messages, makeOpts());
      } catch (e) {
        lastErr = e;
        if (/429|访问量过大|rate limit|超时/i.test(String(e.message))) {
          await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  // 取正文；正文为空或过短（说明被推理挤占/截断）时，合并推理内容兜底
  const pick = (raw) => {
    const c = normalizeReply(raw.content);
    if (c && c.trim().length >= 15) return c.trim();
    return normalizeReply(`${raw.content}\n${raw.reasoning || ''}`);
  };

  const baseMessages = [{ role: 'system', content: system }, { role: 'user', content: userContent }];
  let raw = await askWithRetry(baseMessages);
  let text = pick(raw);

  // 结果退化为“是/不是/无效”等单个判定词时，判定为生成失败，带更强要求重试一次
  if (/^(是|不是|无效)[。.]?$/.test(text.trim())) {
    raw = await askWithRetry([
      { role: 'system', content: `${system} 必须输出对主题的正式介绍内容（3~6 条要点，每条以“- ”开头），禁止只回答“是/不是”等单个词。` },
      { role: 'user', content: userContent },
    ]);
    text = pick(raw);
  }

  return text;
}

module.exports = {
  PROVIDERS,
  getProviderCatalog,
  resolveLlmConfig,
  isLlmConfigured,
  chat,
  judgeWithLlm,
  parseJudgeReply,
  stripThinking,
  normalizeReply,
  extractFinalAnswer,
  introduceCountry,
  introduceByPrompt,
};
